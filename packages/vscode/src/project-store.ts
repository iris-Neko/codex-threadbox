import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ProjectRecord, ProjectSnapshot, ThreadRecord } from '../../../src/shared/contracts'
import type { Project } from '../../../src/shared/protocol/generated/v2/Project'
import type { CodexProjectCatalog } from './codex-projects'

const SCHEMA_VERSION = 1
const MAX_PROJECT_NAME = 80
const REPLACE_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

interface StoredProject {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

interface ProjectFile {
  schemaVersion: 1
  projects: StoredProject[]
  assignments: Record<string, string>
}

function emptyFile(): ProjectFile {
  return { schemaVersion: SCHEMA_VERSION, projects: [], assignments: {} }
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
      updatedAt: item.updatedAt
    })
  }

  const assignments: Record<string, string> = {}
  for (const [threadId, projectId] of Object.entries(value.assignments)) {
    if (!threadId || typeof projectId !== 'string' || !projectId) return null
    assignments[threadId] = projectId
  }
  return { schemaVersion: SCHEMA_VERSION, projects, assignments }
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
    if (Object.keys(assignments).length !== Object.keys(data.assignments).length) {
      data.assignments = assignments
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
    data.projects = data.projects.filter((project) => project.id !== id)
    data.assignments = Object.fromEntries(
      Object.entries(data.assignments).filter(([, projectId]) => projectId !== id)
    )
    await this.save(data)
    return this.snapshot(data)
  }

  async assign(threadIds: string[], projectId: string | null): Promise<ProjectSnapshot> {
    const data = await this.load()
    if (projectId !== null && !data.projects.some((project) => project.id === projectId)) {
      throw new Error('Threadbox project not found.')
    }
    const byId = new Map(this.threads.map((thread) => [thread.id, thread]))
    const roots = new Set<string>()
    for (const id of threadIds) {
      const thread = byId.get(id)
      if (!thread) throw new Error(`Task not found: ${id}`)
      roots.add(rootId(thread, byId))
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
    if (!data.projects.some((project) => project.id === projectId)) {
      throw new Error('Threadbox project not found.')
    }
    data.assignments[threadId] = projectId
    await this.save(data)
  }

  private ensureUnique(data: ProjectFile, name: string, excludedId?: string): void {
    const key = name.toLocaleLowerCase()
    if (data.projects.some((project) => project.id !== excludedId &&
      project.name.toLocaleLowerCase() === key)) throw new Error('A project with this name already exists.')
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
      readOnly: false,
      codexProjectId: null,
      roots: uniquePaths(Object.entries(data.assignments)
        .filter(([, projectId]) => projectId === project.id)
        .map(([threadId]) => this.threads.find((thread) => thread.id === threadId)?.cwd)
        .filter((path): path is string => Boolean(path))),
      canCreateThread: true,
      createThreadUnavailableReason: null
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
