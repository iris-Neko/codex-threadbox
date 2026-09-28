// @vitest-environment node
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claudeConfigDirectory, claudeSessionMetadata, groupClaudeSessions, sameClaudeWorkspace } from '../../packages/vscode/src/claude-history'
import { LocalClaudeHistoryReader } from '../../packages/vscode/src/claude-history-reader'
import { ClaudeResumeStore } from '../../packages/vscode/src/claude-resume'

let directory: string
let workerPath: string
const idA = '11111111-1111-4111-8111-111111111111'
const idB = '22222222-2222-4222-8222-222222222222'
const session = { id: idA, title: 'Fixture', cwd: '/work/project', updatedAt: 100, createdAt: null }

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'threadbox-claude-unit-'))
  workerPath = join(directory, 'worker.mjs')
  await build({ entryPoints: ['packages/vscode/src/claude-history-worker.ts'], outfile: workerPath,
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } })
})
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('Claude history metadata', () => {
  it('retains only bounded display metadata, never messages or the first prompt', () => {
    const metadata = claudeSessionMetadata({ sessionId: idA, summary: 'fallback', customTitle: 'A\nTitle',
      cwd: '/work/a', lastModified: 123, createdAt: 100, firstPrompt: 'secret', messages: ['secret'] })
    expect(metadata).toEqual({ id: idA, title: 'A Title', cwd: '/work/a', updatedAt: 123, createdAt: 100 })
    expect(claudeSessionMetadata({ sessionId: '../../evil', lastModified: 1 })).toBeNull()
    expect(claudeSessionMetadata({ sessionId: idA, lastModified: NaN })).toBeNull()
    expect(claudeSessionMetadata({ sessionId: idA, lastModified: 1, summary: 'a'.repeat(5000) })?.title).toHaveLength(256)
  })

  it.each([
    ['C:\\Work\\A', ['c:/work/a/'], true],
    ['\\\\SERVER\\Share\\A', ['//server/share/a'], true],
    ['/work/A', ['/work/a'], false],
    ['/work/app/sub', ['/work/app'], false],
    ['/work/app', ['/work/app', '/work/other'], false],
    ['/work/app', [], false]
  ])('only resumes directly in an exact single-root workspace: %s', (cwd, folders, matches) => {
    expect(sameClaudeWorkspace(cwd, folders)).toBe(matches)
  })

  it('groups all directories, newest first, and searches titles, paths and IDs', () => {
    const records = [session, { ...session, id: idB, title: 'Different task', cwd: '/elsewhere', updatedAt: 200 }]
    expect(groupClaudeSessions(records, '').map((group) => group.cwd)).toEqual(['/elsewhere', '/work/project'])
    expect(groupClaudeSessions(records, 'different')[0]?.sessions[0]?.id).toBe(idB)
    expect(groupClaudeSessions(records, '/work')[0]?.sessions[0]?.id).toBe(idA)
    expect(groupClaudeSessions(records, idB)).toHaveLength(1)
    expect(groupClaudeSessions([{ ...session, cwd: null }], '')[0]?.cwd).toBeNull()
  })

  it('follows the official config environment without reading unrelated secrets', () => {
    const base = resolve('claude-test-config')
    expect(claudeConfigDirectory(undefined, [{ name: 'CLAUDE_CONFIG_DIR', value: base }], {})).toBe(base)
    expect(claudeConfigDirectory(base, [], { CLAUDE_CONFIG_DIR: resolve('other') })).toBe(base)
    expect(() => claudeConfigDirectory('relative', [], {})).toThrow('absolute')
  })

  it('reads cross-folder histories with the official SDK in isolated homes, without writes or a model', async () => {
    const home = join(directory, 'history')
    const cwdA = join(directory, 'work-A'), cwdB = join(directory, 'work-B')
    const paths: string[] = []
    for (const [id, cwd, title, sidechain] of [[idA, cwdA, 'First session', false], [idB, cwdB, 'Second session', false],
      ['33333333-3333-4333-8333-333333333333', cwdB, 'Hidden subagent', true]] as const) {
      const project = join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/gu, '-'))
      await mkdir(project, { recursive: true })
      const path = join(project, id + '.jsonl')
      await writeFile(path, [
        { type: 'user', uuid: id, parentUuid: null, sessionId: id, cwd, isSidechain: sidechain,
          timestamp: '2026-09-01T00:00:00Z', message: { role: 'user', content: 'PRIVATE_BODY_DO_NOT_DISPLAY' } },
        { type: 'custom-title', sessionId: id, customTitle: title }
      ].map((row) => JSON.stringify(row)).join('\n') + '\n')
      paths.push(path)
    }
    // Malformed unrelated histories must not hide valid conversations.
    await writeFile(join(home, 'projects', cwdA.replace(/[^a-zA-Z0-9]/gu, '-'),
      '55555555-5555-4555-8555-555555555555.jsonl'), 'incomplete JSON\n')
    const treeBefore = await readdir(home, { recursive: true })
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
    const inherited = process.env.CLAUDE_CONFIG_DIR
    const reader = new LocalClaudeHistoryReader(workerPath)
    try {
      const records = await reader.list(home)
      expect(new Set(records.map((row) => row.id))).toEqual(new Set([idA, idB]))
      expect(records.map((row) => row.cwd).sort()).toEqual([cwdA, cwdB].sort())
      expect(JSON.stringify(records)).not.toContain('PRIVATE_BODY_DO_NOT_DISPLAY')
      expect((await reader.get(home, idA, cwdA))?.title).toBe('First session')
      expect(await reader.get(home, '44444444-4444-4444-8444-444444444444', cwdA)).toBeNull()
      expect(await reader.list(join(directory, 'missing-home'))).toEqual([])
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(inherited)
      expect(await Promise.all(paths.map((path) => readFile(path, 'utf8')))).toEqual(before)
      expect(await readdir(home, { recursive: true })).toEqual(treeBefore)
    } finally { reader.dispose() }
  })

  it('rejects invalid IDs and shuts down readers without touching user data', async () => {
    const reader = new LocalClaudeHistoryReader(workerPath)
    await expect(reader.get(directory, '--dangerous', directory)).rejects.toThrow('Invalid')
    reader.dispose()
    await expect(reader.list(directory)).rejects.toThrow('closed')
  })
})

describe('cross-window Claude resume handoff', () => {
  it('only consumes a request once, for the exact folder and config directory', async () => {
    const store = new ClaudeResumeStore(join(directory, 'handoff'))
    await store.enqueue(session, '/claude-home')
    expect(await store.take(['/wrong'], '/claude-home')).toBeNull()
    expect(await store.take(['/work/project', '/other'], '/claude-home')).toBeNull()
    expect(await store.take(['/work/project'], '/wrong-home')).toBeNull()
    const result = await Promise.all([store.take(['/work/project'], '/claude-home'), store.take(['/work/project'], '/claude-home')])
    expect(result.filter(Boolean)).toHaveLength(1)
    expect(result.find(Boolean)?.sessionId).toBe(idA)
    expect(await store.take(['/work/project'], '/claude-home')).toBeNull()
  })
  it('cancels failed window opens and discards expired requests', async () => {
    const path = join(directory, 'handoff-cancel')
    const store = new ClaudeResumeStore(path)
    const cancel = await store.enqueue(session, '/claude-home')
    await cancel()
    expect(await store.take(['/work/project'], '/claude-home')).toBeNull()
    await store.enqueue(session, '/claude-home')
    const file = join(path, (await readdir(path))[0]!)
    const request = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...request, expiresAt: Date.now() - 1 }))
    expect(await store.take(['/work/project'], '/claude-home')).toBeNull()
    expect(await readdir(path)).toEqual([])
  })
})
