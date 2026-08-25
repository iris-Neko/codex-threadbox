import { randomUUID } from 'node:crypto'
import type {
  CreatedProjectThread,
  ProjectRecord
} from '../../../src/shared/contracts'
import type { Project } from '../../../src/shared/protocol/generated/v2/Project'
import type { ThreadStartParams } from '../../../src/shared/protocol/generated/v2/ThreadStartParams'
import type { ThreadStartResponse } from '../../../src/shared/protocol/generated/v2/ThreadStartResponse'
import type { RpcClientLike } from '../../core/src/app-server-client'

const PROJECT_PAGE_SIZE = 100

interface ProjectListResponse {
  data: Project[]
  nextCursor: string | null
}

interface ProjectCreateResponse {
  project: Project
}

interface ProjectUpdateResponse {
  project: Project
}

type ExperimentalThreadStartParams = ThreadStartParams & { projectId?: string }

export interface CodexProjectCatalog {
  available: boolean
  projects: Project[]
  message: string | null
}

export interface DirectoryPicker {
  pickRoot(roots: readonly string[]): Promise<string | null>
  pickFolder(): Promise<string | null>
}

export interface ProjectRootsPicker {
  pickWorkspaceRoots(roots: readonly string[]): Promise<string[] | null>
  pickFolders(): Promise<string[] | null>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizedThreadName(name: string): string {
  const normalized = name.trim()
  if (!normalized || normalized.length > 512 ||
    [...normalized].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('Task names must contain 1-512 visible characters.')
  }
  return normalized
}

function normalizedProjectName(name: string): string {
  const normalized = name.trim()
  if (!normalized || normalized.length > 80 ||
    [...normalized].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('Project names must contain 1-80 visible characters.')
  }
  return normalized
}

function normalizedProjectRoots(roots: readonly string[]): string[] {
  const normalized = [...new Set(roots.map((root) => root.trim()).filter(Boolean))]
  if (normalized.length === 0 || normalized.some((root) => root.length > 32_768 ||
    [...root].some((character) => character.charCodeAt(0) < 32))) {
    throw new Error('At least one valid project root is required.')
  }
  return normalized
}

export async function listCodexProjects(client: RpcClientLike): Promise<CodexProjectCatalog> {
  const projects: Project[] = []
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  try {
    do {
      const response: ProjectListResponse = await client.request<ProjectListResponse>('project/list', {
        cursor,
        limit: PROJECT_PAGE_SIZE
      })
      projects.push(...response.data)
      cursor = response.nextCursor
      if (cursor && seenCursors.has(cursor)) throw new Error('Codex returned a repeated project cursor.')
      if (cursor) seenCursors.add(cursor)
    } while (cursor)
    return { available: true, projects, message: null }
  } catch (error) {
    return {
      available: false,
      projects: [],
      message: `Codex project management is unavailable: ${errorMessage(error)}`
    }
  }
}

export async function chooseOfficialProjectRoots(
  workspaceRoots: readonly string[],
  picker: ProjectRootsPicker
): Promise<string[] | null> {
  if (workspaceRoots.length === 1) return [workspaceRoots[0]!]
  if (workspaceRoots.length > 1) return picker.pickWorkspaceRoots(workspaceRoots)
  return picker.pickFolders()
}

export async function createCodexProject(
  client: RpcClientLike,
  name: string,
  roots: readonly string[]
): Promise<Project> {
  const response = await client.request<ProjectCreateResponse>('project/create', {
    name: normalizedProjectName(name),
    roots: normalizedProjectRoots(roots).map((path) => ({ path })),
    idempotencyKey: randomUUID()
  })
  return response.project
}

export async function renameCodexProject(
  client: RpcClientLike,
  projectId: string,
  name: string
): Promise<Project> {
  if (!projectId) throw new Error('The Codex project ID is unavailable.')
  const response = await client.request<ProjectUpdateResponse>('project/update', {
    projectId,
    name: normalizedProjectName(name)
  })
  return response.project
}

export async function deleteCodexProject(
  client: RpcClientLike,
  projectId: string
): Promise<void> {
  if (!projectId) throw new Error('The Codex project ID is unavailable.')
  await client.request('project/delete', { projectId })
}

export async function chooseProjectDirectory(
  project: ProjectRecord,
  picker: DirectoryPicker
): Promise<string | null> {
  if (!project.canCreateThread) {
    throw new Error(project.createThreadUnavailableReason ??
      'Creating tasks in this project is unavailable.')
  }
  if (project.roots.length === 1) return project.roots[0]!
  if (project.roots.length > 1) return picker.pickRoot(project.roots)
  return picker.pickFolder()
}

export async function createProjectThread(
  client: RpcClientLike,
  project: ProjectRecord,
  name: string,
  cwd: string,
  assignThreadbox: (threadId: string, projectId: string) => Promise<void>
): Promise<CreatedProjectThread> {
  const normalizedName = normalizedThreadName(name)
  if (!cwd) throw new Error('A working directory is required.')

  const params: ExperimentalThreadStartParams = { cwd }
  if (project.kind === 'official') {
    if (!project.codexProjectId) throw new Error('The Codex project ID is unavailable.')
    params.projectId = project.codexProjectId
  }

  let threadId: string | null = null
  try {
    const started = await client.request<ThreadStartResponse>('thread/start', params)
    threadId = started.thread.id
    await client.request('thread/name/set', { threadId, name: normalizedName })
    if (project.kind === 'threadbox') await assignThreadbox(threadId, project.id)
    return { threadId, name: normalizedName, cwd, projectId: project.id }
  } catch (error) {
    if (!threadId) throw error
    try {
      await client.request('thread/delete', { threadId })
    } catch (rollbackError) {
      throw new Error(
        `${errorMessage(error)} The new task ${threadId} could not be removed: ${errorMessage(rollbackError)}`,
        { cause: rollbackError }
      )
    }
    throw error
  }
}
