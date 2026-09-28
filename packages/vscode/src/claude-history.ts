import { homedir } from 'node:os'
import { isAbsolute, join, posix, win32 } from 'node:path'

/** Metadata only. Never pass SDK messages, firstPrompt or transcript paths to the UI. */
export interface ClaudeSession {
  id: string
  title: string
  cwd: string | null
  updatedAt: number
  createdAt: number | null
}

export interface ClaudeHistoryReader {
  list(configDir: string): Promise<ClaudeSession[]>
  get(configDir: string, id: string, cwd: string): Promise<ClaudeSession | null>
}

export function isClaudeSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(value)
}

export function validClaudeDirectory(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 32768 &&
    ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    (posix.isAbsolute(value) || win32.isAbsolute(value))
}

export function claudePathKey(path: string): string {
  const windows = /^[a-z]:[\\/]/iu.test(path) || path.startsWith('\\\\') || path.startsWith('//')
  const normalized = (windows ? win32.normalize(path).replaceAll('\\', '/') : posix.normalize(path))
    .replace(/\/+$/u, '') || '/'
  return windows ? normalized.toLowerCase() : normalized
}

export function sameClaudeWorkspace(cwd: string, folders: readonly string[]): boolean {
  // The official extension chooses one cwd. A matching subdirectory or one root
  // of a multi-root workspace is not proof that it will resume in the right cwd.
  return folders.length === 1 && claudePathKey(cwd) === claudePathKey(folders[0]!)
}

export function claudeConfigDirectory(override: unknown, variables: unknown, env: NodeJS.ProcessEnv): string {
  const fromExtension = Array.isArray(variables) ? variables.findLast((item: unknown) =>
    typeof item === 'object' && item !== null && 'name' in item && item.name === 'CLAUDE_CONFIG_DIR') : undefined
  const path = (typeof override === 'string' && override.trim()) ||
    (typeof fromExtension?.value === 'string' && fromExtension.value.trim()) ||
    env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const expanded = path === '~' ? homedir() : /^~[\\/]/u.test(path) ? join(homedir(), path.slice(2)) : path
  if (!validClaudeDirectory(expanded) || !isAbsolute(expanded)) {
    throw new Error('Claude config directory must be an absolute path on this extension host.')
  }
  return expanded
}

export function claudeSessionMetadata(value: unknown): ClaudeSession | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (!isClaudeSessionId(row.sessionId) || typeof row.lastModified !== 'number' ||
    !Number.isFinite(row.lastModified)) return null
  const title = typeof row.customTitle === 'string' && row.customTitle.trim() ? row.customTitle : row.summary
  return {
    id: row.sessionId,
    title: [...(typeof title === 'string' ? title : row.sessionId).slice(0, 1024)].map((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').trim().slice(0, 256) || row.sessionId,
    cwd: validClaudeDirectory(row.cwd) ? row.cwd : null,
    updatedAt: row.lastModified,
    createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : null
  }
}

export function groupClaudeSessions(sessions: readonly ClaudeSession[], query: string): Array<{
  key: string; cwd: string | null; sessions: ClaudeSession[]
}> {
  const groups = new Map<string, { key: string; cwd: string | null; sessions: ClaudeSession[] }>()
  const search = query.trim().toLocaleLowerCase()
  for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))) {
    if (search && ![session.title, session.cwd ?? '', session.id].join('\n').toLocaleLowerCase().includes(search)) continue
    const key = session.cwd ? claudePathKey(session.cwd) : 'unknown'
    const group = groups.get(key) ?? { key, cwd: session.cwd, sessions: [] }
    if (!group.sessions.some((item) => item.id === session.id)) group.sessions.push(session)
    groups.set(key, group)
  }
  return [...groups.values()]
}
