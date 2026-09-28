import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { claudeSessionMetadata, type ClaudeSession } from './claude-history'

// This worker's environment isolates CLAUDE_CONFIG_DIR from other extensions.
// Only official metadata readers are used: no query, resume, message reads or CLI.
async function read(): Promise<ClaudeSession[] | ClaudeSession | null> {
  try { await access(join(process.env.CLAUDE_CONFIG_DIR!, 'projects')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return workerData.id ? null : []
    throw new Error('Claude history directory is not readable. Check its permissions.', { cause: error })
  }
  if (workerData.id) {
    return claudeSessionMetadata(await getSessionInfo(workerData.id, { dir: workerData.cwd }))
  }
  // Omitting dir is deliberate: history must not be scoped to the current folder.
  return (await listSessions({ includeProgrammatic: false }))
    .map(claudeSessionMetadata).filter((row): row is ClaudeSession => row !== null)
}

void read().then(
  (data) => parentPort?.postMessage({ data }),
  () => parentPort?.postMessage({ error: 'Could not read Claude Code history. Check the config directory and its permissions, then refresh.' })
)
