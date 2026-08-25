import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ProjectRecord, ProjectSnapshot, ThreadRecord } from '../../../src/shared/contracts'
import type { Project } from '../../../src/shared/protocol/generated/v2/Project'
import type { CodexProjectCatalog } from './codex-projects'

const SCHEMA_VERSION = 1
const MAX_PROJECT_NAME = 80
const DEFAULT_TRASH_PROJECT_ID = 'threadbox:trash'
const REPLACE_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

interface StoredProject {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  systemKind?: 'trash'
}

interface ProjectFile {
  schemaVersion: 1
  projects: StoredProject[]
  assignments: Record<string, string>
  trashOrigins: Record<string, string | null>
}

function trashProject(now = Date.now()): StoredProject {
  return {
    id: DEFAULT_TRASH_PROJECT_ID,
    name: 'Trash',
    createdAt: now,
    updatedAt: now,
    systemKind: 'trash'
  }
}

function emptyFile(): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    projects: [trashProject()],
    assignments: {},
    trashOrigins: {}
  }
}

async function replaceFile(temporaryPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporaryPath, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 4 || !code || !REPLACE_RETRY_CODES.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

function normalizedName(name: string): string {
  const value = name.trim()
  if (!value || value.length > MAX_PROJECT_NAME ||
    [...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error(`Project names must contain 1-${MAX_PROJECT_NAME} visible characters.`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFile(value: unknown): ProjectFile | null {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(value.projects) || !isRecord(value.assignments)) return null

  const projects: StoredProject[] = []
  for (const item of value.projects) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' ||
      typeof item.createdAt !== 'number' || typeof item.updatedAt !== 'number') return null
    projects.push({
      id: item.id,
      name: normalizedName(item.name),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      systemKind: item.systemKind === 'trash' ? 'trash' : undefined
    })
  }

  const assignments: Record<string, string> = {}
  for (const [threadId, projectId] of Object.entries(value.assignments)) {
    if (!threadId || typeof projectId !== 'string' || !projectId) return null
    assignments[threadId] = projectId
  }

  const trashOrigins: Record<string, string | null> = {}
  if (value.trashOrigins !== undefined) {
    if (!isRecord(value.trashOrigins)) return null
    for (const [threadId, projectId] of Object.entries(value.trashOrigins)) {
      if (!threadId || (projectId !== null && (typeof projectId !== 'string' || !projectId))) return null
      trashOrigins[threadId] = projectId
    }
  }

  let trash = projects.find((project) => project.systemKind === 'trash') ??
    projects.find((project) => project.name.toLocaleLowerCase() === 'trash') ??
    projects.find((project) => project.id === DEFAULT_TRASH_PROJECT_ID)
  if (!trash) {
    trash = trashProject()
    projects.push(trash)
  }
  trash.name = 'Trash'
  trash.systemKind = 'trash'
  for (const project of projects) {
    if (project !== trash && project.systemKind === 'trash') delete project.systemKind
  }
  for (const [threadId, projectId] of Object.entries(assignments)) {
    if (projectId === trash.id && trashOrigins[threadId] === undefined) trashOrigins[threadId] = null
  }

  return { schemaVersion: SCHEMA_VERSION, projects, assignments, trashOrigins }
}

function rootId(thread: ThreadRecord, byId: Map<string, ThreadRecord>): string {
  let current = thread
  const visited = new Set([thread.id])
  while (current.parentThreadId && !visited.has(current.parentThreadId)) {
    const parent = byId.get(current.parentThreadId)
    if (!parent) break
    visited.add(parent.id)
    current = parent
  }
  return current.id
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLocaleLowerCase()
    : normalized
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = pathKey(path)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function inferredOfficialProjects(
  threads: ThreadRecord[],
  unavailableReason: string
): ProjectRecord[] {
  const seen = new Map<string, ProjectRecord>()
  for (const thread of threads) {
    if (!thread.projectId) continue
    const existing = seen.get(thread.projectId)
    if (existing) {
      existing.roots = uniquePaths([...existing.roots, thread.cwd])
      continue
    }
    const directory = thread.cwd.replace(/[\\/]+$/, '')
    seen.set(thread.projectId, {
      id: `official:${thread.projectId}`,
      name: basename(directory) || thread.projectId,
      kind: 'official',
      readOnly: true,
      codexProjectId: thread.projectId,
      roots: [thread.cwd],
      canCreateThread: false,
      createThreadUnavailableReason: unavailableReason,
      createdAt: null,
      updatedAt: null
    })
  }
  return [...seen.values()].toSorted((left, right) => left.name.localeCompare(right.name))
}

function catalogProject(project: Project): ProjectRecord {
  return {
    id: `official:${project.id}`,
    name: project.name,
    kind: 'official',
    readOnly: false,
    codexProjectId: project.id,
    roots: uniquePaths(project.roots.map((root) => String(root.path))),
    canCreateThread: true,
    createThreadUnavailableReason: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
}

export class ProjectStore {
  private data: ProjectFile | null = null
  private loading: Promise<ProjectFile> | null = null
  private threads: ThreadRecord[] = []
  private codexProjects: CodexProjectCatalog | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async setInventory(
    threads: ThreadRecord[],
    codexProjects?: CodexProjectCatalog
  ): Promise<ProjectSnapshot> {
    this.threads = threads
    if (codexProjects !== undefined) this.codexProjects = codexProjects
    const data = await this.load()
    const validRoots = new Set<string>()
    const byId = new Map(threads.map((thread) => [thread.id, thread]))
    for (const thread of threads) validRoots.add(rootId(thread, byId))
    const projectIds = new Set(data.projects.map((project) => project.id))
    const assignments = Object.fromEntries(
      Object.entries(data.assignments).filter(([threadId, projectId]) =>
        validRoots.has(threadId) && projectIds.has(projectId)
      )
    )
    const trashOrigins = Object.fromEntries(
      Object.entries(data.trashOrigins).filter(([threadId, projectId]) =>
        validRoots.has(threadId) && (projectId === null || projectIds.has(projectId))
      )
    )
    if (Object.keys(assignments).length !== Object.keys(data.assignments).length ||
      Object.keys(trashOrigins).length !== Object.keys(data.trashOrigins).length) {
      data.assignments = assignments
      data.trashOrigins = trashOrigins
      await this.save(data)
    }
    return this.snapshot(data)
  }

  async list(): Promise<ProjectSnapshot> {
    return this.snapshot(await this.load())
  }

  async getProject(id: string): Promise<ProjectRecord | null> {
    return (await this.list()).projects.find((project) => project.id === id) ?? null
  }

  async create(name: string): Promise<ProjectSnapshot> {
    const data = await this.load()
    const projectName = normalizedName(name)
    this.ensureUnique(data, projectName)
    const now = Date.now()
    data.projects.push({ id: `threadbox:${randomUUID()}`, name: projectName, createdAt: now, updatedAt: now })
    await this.save(data)
    return this.snapshot(data)
  }

  async renameProject(id: string, name: string): Promise<ProjectSnapshot> {
    const data = await this.load()
    const project = data.projects.find((item) => item.id === id)
    if (!project) throw new Error('Threadbox project not found.')
    if (project.systemKind === 'trash') throw new Error('The Trash project cannot be renamed.')
    const projectName = normalizedName(name)
    this.ensureUnique(data, projectName, id)
    project.name = projectName
    project.updatedAt = Date.now()
    await this.save(data)
    return this.snapshot(data)
  }

  async deleteProject(id: string): Promise<ProjectSnapshot> {
    const data = await this.load()
    if (!data.projects.some((project) => project.id === id)) {
      throw new Error('Threadbox project not found.')
    }
    if (data.projects.some((project) => project.id === id && project.systemKind === 'trash')) {
      throw new Error('The Trash project cannot be deleted.')
    }
    data.projects = data.projects.filter((project) => project.id !== id)
    data.assignments = Object.fromEntries(
      Object.entries(data.assignments).filter(([, projectId]) => projectId !== id)
    )
    data.trashOrigins = Object.fromEntries(
      Object.entries(data.trashOrigins).map(([threadId, projectId]) => [
        threadId,
        projectId === id ? null : projectId
      ])
    )
    await this.save(data)
    return this.snapshot(data)
  }

  async assign(threadIds: string[], projectId: string | null): Promise<ProjectSnapshot> {
    const data = await this.load()
    const target = projectId === null ? null : data.projects.find((project) => project.id === projectId)
    if (projectId !== null && !target) {
      throw new Error('Threadbox project not found.')
    }
    if (target?.systemKind === 'trash') throw new Error('Use the task Trash operation instead.')
    const roots = this.resolveRootIds(threadIds)
    const trashId = this.trashProject(data).id
    if (roots.some((id) => data.assignments[id] === trashId)) {
      throw new Error('Restore tasks from Trash before assigning them to another project.')
    }
    for (const id of roots) {
      if (projectId === null) delete data.assignments[id]
      else data.assignments[id] = projectId
    }
    await this.save(data)
    return this.snapshot(data)
  }

  async assignCreatedThread(threadId: string, projectId: string): Promise<void> {
    if (!threadId) throw new Error('Task ID must not be empty.')
    const data = await this.load()
    const project = data.projects.find((item) => item.id === projectId)
    if (!project) {
      throw new Error('Threadbox project not found.')
    }
    if (project.systemKind === 'trash') throw new Error('Tasks cannot be created directly in Trash.')
    data.assignments[threadId] = projectId
    await this.save(data)
  }

  resolveRootIds(threadIds: readonly string[]): string[] {
    const byId = new Map(this.threads.map((thread) => [thread.id, thread]))
    const roots = new Set<string>()
    for (const id of threadIds) {
      const thread = byId.get(id)
      if (!thread) throw new Error(`Task not found: ${id}`)
      roots.add(rootId(thread, byId))
    }
    return [...roots]
  }

  async getTrashProjectId(): Promise<string> {
    return this.trashProject(await this.load()).id
  }

  async filterTrashRoots(threadIds: readonly string[]): Promise<string[]> {
    const data = await this.load()
    const trashId = this.trashProject(data).id
    return this.resolveRootIds(threadIds).filter((id) => data.assignments[id] === trashId)
  }

  async listTrashRoots(): Promise<string[]> {
    const data = await this.load()
    const trashId = this.trashProject(data).id
    return Object.entries(data.assignments)
      .filter(([, projectId]) => projectId === trashId)
      .map(([threadId]) => threadId)
  }

  async moveToTrash(threadIds: readonly string[]): Promise<ProjectSnapshot> {
    const data = await this.load()
    const next = this.copyFile(data)
    const trashId = this.trashProject(next).id
    for (const id of this.resolveRootIds(threadIds)) {
      if (next.assignments[id] === trashId) continue
      next.trashOrigins[id] = next.assignments[id] ?? null
      next.assignments[id] = trashId
    }
    await this.save(next)
    return this.snapshot(next)
  }

  async restoreFromTrash(
    threadIds: readonly string[],
    projectId?: string | null
  ): Promise<ProjectSnapshot> {
    const data = await this.load()
    const next = this.copyFile(data)
    const trashId = this.trashProject(next).id
    if (projectId !== undefined && projectId !== null) {
      const target = next.projects.find((project) => project.id === projectId)
      if (!target || target.systemKind === 'trash') throw new Error('Threadbox project not found.')
    }
    for (const id of this.resolveRootIds(threadIds)) {
      if (next.assignments[id] !== trashId) continue
      const origin = projectId === undefined ? next.trashOrigins[id] ?? null : projectId
      if (origin && next.projects.some((project) => project.id === origin && project.systemKind !== 'trash')) {
        next.assignments[id] = origin
      } else {
        delete next.assignments[id]
      }
      delete next.trashOrigins[id]
    }
    await this.save(next)
    return this.snapshot(next)
  }

  async removeFromTrash(threadIds: readonly string[]): Promise<ProjectSnapshot> {
    const data = await this.load()
    const next = this.copyFile(data)
    const trashId = this.trashProject(next).id
    for (const id of threadIds) {
      if (next.assignments[id] === trashId) delete next.assignments[id]
      delete next.trashOrigins[id]
    }
    await this.save(next)
    return this.snapshot(next)
  }

  private ensureUnique(data: ProjectFile, name: string, excludedId?: string): void {
    const key = name.toLocaleLowerCase()
    if (data.projects.some((project) => project.id !== excludedId &&
      project.name.toLocaleLowerCase() === key)) throw new Error('A project with this name already exists.')
  }

  private trashProject(data: ProjectFile): StoredProject {
    const project = data.projects.find((item) => item.systemKind === 'trash')
    if (!project) throw new Error('The Trash project is unavailable.')
    return project
  }

  private copyFile(data: ProjectFile): ProjectFile {
    return {
      schemaVersion: SCHEMA_VERSION,
      projects: data.projects.map((project) => ({ ...project })),
      assignments: { ...data.assignments },
      trashOrigins: { ...data.trashOrigins }
    }
  }

  private async load(): Promise<ProjectFile> {
    if (this.data) return this.data
    this.loading ??= this.loadFromDisk()
    return this.loading
  }

  private async loadFromDisk(): Promise<ProjectFile> {
    try {
      const parsed = parseFile(JSON.parse(await readFile(this.filePath, 'utf8')))
      if (!parsed) throw new Error('Invalid Threadbox project file.')
      this.data = parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const corrupt = `${this.filePath}.corrupt-${Date.now()}`
        await rename(this.filePath, corrupt).catch(() => undefined)
      }
      this.data = emptyFile()
    }
    return this.data
  }

  private async save(data: ProjectFile): Promise<void> {
    const serialized = `${JSON.stringify(data, null, 2)}\n`
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, serialized, 'utf8')
      try { await replaceFile(temporaryPath, this.filePath) }
      catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
        throw error
      }
      this.data = data
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }

  private snapshot(data: ProjectFile): ProjectSnapshot {
    const custom: ProjectRecord[] = data.projects.map((project) => ({
      ...project,
      kind: 'threadbox',
      readOnly: project.systemKind === 'trash',
      codexProjectId: null,
      roots: uniquePaths(Object.entries(data.assignments)
        .filter(([, projectId]) => projectId === project.id)
        .map(([threadId]) => this.threads.find((thread) => thread.id === threadId)?.cwd)
        .filter((path): path is string => Boolean(path))),
      canCreateThread: project.systemKind !== 'trash',
      createThreadUnavailableReason: project.systemKind === 'trash'
        ? 'Tasks cannot be created directly in Trash.'
        : null
    }))
    const unavailableReason = this.codexProjects?.message ??
      'This Codex environment cannot list official project roots. Existing tasks remain available.'
    const inferred = inferredOfficialProjects(this.threads, unavailableReason)
    const official = this.codexProjects?.available
      ? this.mergeOfficialProjects(this.codexProjects.projects.map(catalogProject), inferred)
      : inferred
    return {
      projects: [...custom, ...official],
      assignments: { ...data.assignments },
      refreshedAt: Date.now(),
      canManageOfficialProjects: this.codexProjects?.available ?? false,
      officialProjectManagementUnavailableReason: this.codexProjects?.available
        ? null
        : unavailableReason
    }
  }

  private mergeOfficialProjects(
    catalog: ProjectRecord[],
    inferred: ProjectRecord[]
  ): ProjectRecord[] {
    const merged = new Map(catalog.map((project) => [project.id, project]))
    for (const project of inferred) {
      if (!merged.has(project.id)) merged.set(project.id, project)
    }
    return [...merged.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  }
}
