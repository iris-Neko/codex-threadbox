import type {
  CreatedProjectThread,
  ProjectRecord
} from '../../../src/shared/contracts'
import type { ThreadStartParams } from '../../../src/shared/protocol/generated/v2/ThreadStartParams'
import type { ThreadStartResponse } from '../../../src/shared/protocol/generated/v2/ThreadStartResponse'
import type { ThreadReadResponse } from '../../../src/shared/protocol/generated/v2/ThreadReadResponse'
import type { RpcClientLike } from '../../core/src/app-server-client'

type LegacyThreadStartParams = ThreadStartParams & { historyMode: 'legacy' }
type ThreadStartWithHistory = ThreadStartResponse & {
  thread: { historyMode?: string }
}
type ThreadReadWithHistory = ThreadReadResponse & {
  thread: { historyMode?: string }
}

export interface DirectoryPicker {
  pickRoot(roots: readonly string[]): Promise<string | null>
  pickFolder(): Promise<string | null>
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
  if (project.kind !== 'threadbox') throw new Error('Only Threadbox projects can create tasks.')

  const params: LegacyThreadStartParams = { cwd, historyMode: 'legacy' }

  let threadId: string | null = null
  try {
    const started = await client.request<ThreadStartWithHistory>('thread/start', params)
    threadId = started.thread.id
    if (started.thread.historyMode !== 'legacy') {
      throw new Error('Codex did not create the new task with resumable history.')
    }
    await client.request('thread/name/set', { threadId, name: normalizedName })
    const verified = await client.request<ThreadReadWithHistory>('thread/read', {
      threadId,
      includeTurns: false
    })
    if (verified.thread.id !== threadId || verified.thread.ephemeral ||
      verified.thread.name !== normalizedName || verified.thread.historyMode !== 'legacy') {
      throw new Error('Codex did not persist the new blank task.')
    }
    await assignThreadbox(threadId, project.id)
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
