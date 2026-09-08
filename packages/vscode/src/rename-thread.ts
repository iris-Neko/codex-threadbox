import type { RpcClientLike } from '../../core/src/app-server-client'
import type { ThreadReadResponse } from '../../../src/shared/protocol/generated/v2/ThreadReadResponse'
import { normalizeThreadName, validThreadId } from '../../../src/shared/thread-name'

export async function renameThread(
  client: RpcClientLike, threadId: string, value: string, guard: () => void
): Promise<void> {
  guard()
  if (!validThreadId(threadId)) throw new Error('Invalid task ID.')
  const name = normalizeThreadName(value)
  const params = { threadId, includeTurns: false }
  const before = await client.request<ThreadReadResponse>('thread/read', params)
  guard()
  if (before.thread.id !== threadId || before.thread.ephemeral) {
    throw new Error('The saved task could not be verified. No name was changed.')
  }
  if (before.thread.name === name) return
  try {
    await client.request('thread/name/set', { threadId, name })
  } catch (error) {
    if (error instanceof Error && /no rollout found/iu.test(error.message)) {
      throw new Error('Codex could not find an active session file. Restore archived or trashed tasks before renaming. Task ID: ' + threadId,
        { cause: error })
    }
    throw error
  }
  guard()
  const after = await client.request<ThreadReadResponse>('thread/read', params)
  if (after.thread.id !== threadId || after.thread.name !== name) {
    throw new Error('The rename request was sent, but the saved name could not be confirmed. Refresh before retrying.')
  }
}
