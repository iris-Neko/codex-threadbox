import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudePathKey, isClaudeSessionId, sameClaudeWorkspace, validClaudeDirectory, type ClaudeSession } from './claude-history'

export interface ClaudeResumeRequest {
  sessionId: string
  cwd: string
  configDir: string
  expiresAt: number
}

/** Short-lived IDs/paths in Threadbox storage, never in Claude's history. */
export class ClaudeResumeStore {
  constructor(private readonly directory: string) {}
  async enqueue(session: ClaudeSession, configDir: string): Promise<() => Promise<void>> {
    if (!isClaudeSessionId(session.id) || !validClaudeDirectory(session.cwd) || !validClaudeDirectory(configDir)) {
      throw new Error('Cannot resume a Claude session without a valid original directory.')
    }
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, randomUUID() + '.json')
    const temporary = path + '.tmp'
    const request: ClaudeResumeRequest = {
      sessionId: session.id, cwd: session.cwd, configDir, expiresAt: Date.now() + 5 * 60_000
    }
    try {
      await writeFile(temporary, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } catch (error) { await unlink(temporary).catch(() => {}); throw error }
    return async () => { await unlink(path).catch(() => {}) }
  }

  async take(folders: readonly string[], configDir: string): Promise<ClaudeResumeRequest | null> {
    if (folders.length !== 1) return null
    let names: string[]
    try { names = await readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    for (const name of names) {
      const isClaim = name.endsWith('.json.claimed')
      const original = isClaim ? name.slice(0, -8) : name
      if (!isClaudeSessionId(original.slice(0, -5)) || !original.endsWith('.json')) continue
      const path = join(this.directory, name)
      let request: ClaudeResumeRequest
      try {
        if ((await stat(path)).size > 100_000) continue
        request = JSON.parse(await readFile(path, 'utf8')) as ClaudeResumeRequest
        if (!request || !isClaudeSessionId(request.sessionId) || !validClaudeDirectory(request.cwd) ||
          !validClaudeDirectory(request.configDir) || !Number.isFinite(request.expiresAt)) continue
      } catch { continue }
      if (request.expiresAt < Date.now()) { await unlink(path).catch(() => {}); continue }
      if (isClaim) continue
      if (request.expiresAt > Date.now() + 5 * 60_000 || !sameClaudeWorkspace(request.cwd, folders) ||
        claudePathKey(request.configDir) !== claudePathKey(configDir)) continue
      const claimed = path + '.claimed'
      // Keep an exclusive tombstone until expiry. A rename can succeed twice for
      // overlapping calls on Windows; deleting a claim immediately also races.
      try { await writeFile(claimed, JSON.stringify(request), { flag: 'wx', mode: 0o600 }) } catch { continue }
      await unlink(path).catch(() => {})
      return request
    }
    return null
  }
}
