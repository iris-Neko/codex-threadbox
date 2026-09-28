import { Worker } from 'node:worker_threads'
import { isAbsolute } from 'node:path'
import { isClaudeSessionId, validClaudeDirectory, type ClaudeHistoryReader, type ClaudeSession } from './claude-history'

export class LocalClaudeHistoryReader implements ClaudeHistoryReader {
  private readonly pending = new Set<() => void>()
  private disposed = false
  constructor(private readonly workerPath: string, private readonly timeoutMs = 30_000) {}

  list(configDir: string): Promise<ClaudeSession[]> { return this.read(configDir, {}) }
  get(configDir: string, id: string, cwd: string): Promise<ClaudeSession | null> {
    if (!isClaudeSessionId(id) || !validClaudeDirectory(cwd) || !isAbsolute(cwd)) {
      return Promise.reject(new Error('Invalid Claude session or working directory.'))
    }
    return this.read(configDir, { id, cwd })
  }

  private read<T>(configDir: string, workerData: { id?: string; cwd?: string }): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Claude history reader is closed.'))
    if (!validClaudeDirectory(configDir) || !isAbsolute(configDir)) return Promise.reject(new Error('Invalid Claude config directory.'))
    return new Promise((resolve, reject) => {
      // Metadata lookup needs filesystem paths, not API keys, auth tokens,
      // custom session-store configuration or Node startup hooks.
      const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
        value !== undefined && /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH)$/iu.test(key)))
      const worker = new Worker(this.workerPath, {
        workerData, env: { ...environment, CLAUDE_CONFIG_DIR: configDir }, execArgv: []
      })
      let settled = false
      const finish = (error?: Error, data?: T): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.pending.delete(cancel)
        void worker.terminate()
        if (error) reject(error)
        else resolve(data as T)
      }
      const cancel = (): void => finish(new Error('Claude history loading was cancelled.'))
      const timer = setTimeout(() => finish(new Error('Claude history loading timed out. Refresh to try again.')), this.timeoutMs)
      this.pending.add(cancel)
      worker.once('message', (result: { data?: T; error?: string }) =>
        finish(result.error ? new Error(result.error) : undefined, result.data))
      // Do not expose SDK errors that may include transcript snippets.
      worker.once('error', () => finish(new Error('Claude history reader failed to start.')))
      worker.once('exit', () => finish(new Error('Claude history reader exited before returning metadata.')))
    })
  }

  dispose(): void {
    this.disposed = true
    for (const cancel of this.pending) cancel()
  }
}
