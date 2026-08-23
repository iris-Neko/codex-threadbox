import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopRecentsRepair } from '../../src/main/desktop-recents-repair'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fixture(): Promise<{
  root: string
  databasePath: string
  backupDirectory: string
  stateDatabasePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'threadbox-recents-'))
  temporaryDirectories.push(root)
  const databasePath = join(root, 'codex-dev.db')
  const backupDirectory = join(root, 'backups')
  const stateDatabasePath = join(root, 'state_5.sqlite')
  const stateRolloutPath = join(root, 'state-live.jsonl')
  await writeFile(stateRolloutPath, '{}\n', 'utf8')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE local_thread_catalog (
      host_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      display_title TEXT NOT NULL,
      source_created_at REAL NOT NULL,
      source_updated_at REAL NOT NULL,
      source_recency_at REAL NOT NULL,
      missing_candidate INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (host_id, thread_id)
    );
    CREATE TABLE local_thread_catalog_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      catalog_revision INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO local_thread_catalog_metadata (id, catalog_revision) VALUES (1, 0);
    INSERT INTO local_thread_catalog VALUES
      ('local', 'live', 'Live task', 3, 3, 3, 0),
      ('local', 'state-live', 'State-backed task', 3, 3, 3, 0),
      ('local', 'stale-new', 'New stale task', 2, 2, 2, 0),
      ('local', 'stale-old', 'Old stale task', 1, 1, 1, 0),
      ('local', 'already-missing', 'Hidden candidate', 1, 1, 1, 1),
      ('chatgpt:user', 'cloud', 'Cloud task', 1, 1, 1, 0);
  `)
  database.close()
  const stateDatabase = new DatabaseSync(stateDatabasePath)
  stateDatabase.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL)')
  stateDatabase.prepare('INSERT INTO threads (id, rollout_path) VALUES (?, ?)').run(
    'state-live',
    stateRolloutPath
  )
  stateDatabase.close()
  return { root, databasePath, backupDirectory, stateDatabasePath }
}

describe('DesktopRecentsRepair', () => {
  it('detects only visible local entries that are absent from the App Server inventory', async () => {
    const { databasePath, backupDirectory, stateDatabasePath } = await fixture()
    const repair = new DesktopRecentsRepair(databasePath, backupDirectory, stateDatabasePath)

    const status = await repair.inspect(new Set(['live']))

    expect(status).toMatchObject({ state: 'stale', staleCount: 2, message: null })
    expect(status.staleEntries.map((entry) => entry.id)).toEqual(['stale-new', 'stale-old'])
  })

  it('backs up the catalog and removes only confirmed stale local entries', async () => {
    const { databasePath, backupDirectory, stateDatabasePath } = await fixture()
    const repair = new DesktopRecentsRepair(databasePath, backupDirectory, stateDatabasePath)

    const result = await repair.repair(new Set(['live']))

    expect(result.removed).toBe(2)
    expect(result.status.state).toBe('clean')
    expect(result.backupPath).toBeTruthy()
    await access(result.backupPath!)
    expect(await readdir(backupDirectory)).toHaveLength(1)

    const database = new DatabaseSync(databasePath, { readOnly: true })
    const visible = database
      .prepare('SELECT host_id, thread_id FROM local_thread_catalog ORDER BY host_id, thread_id')
      .all()
    const revision = database
      .prepare('SELECT catalog_revision FROM local_thread_catalog_metadata WHERE id = 1')
      .get() as { catalog_revision: number }
    database.close()

    expect(visible).toEqual([
      { host_id: 'chatgpt:user', thread_id: 'cloud' },
      { host_id: 'local', thread_id: 'already-missing' },
      { host_id: 'local', thread_id: 'live' },
      { host_id: 'local', thread_id: 'state-live' }
    ])
    expect(revision.catalog_revision).toBe(1)

    const backupDatabase = new DatabaseSync(result.backupPath!, { readOnly: true })
    const backupCount = backupDatabase
      .prepare("SELECT COUNT(*) AS count FROM local_thread_catalog WHERE host_id = 'local'")
      .get() as { count: number }
    backupDatabase.close()
    expect(backupCount.count).toBe(5)
  })

  it('does not write an unsupported database schema', async () => {
    const root = await mkdtemp(join(tmpdir(), 'threadbox-recents-'))
    temporaryDirectories.push(root)
    const databasePath = join(root, 'codex-dev.db')
    const database = new DatabaseSync(databasePath)
    database.exec('CREATE TABLE something_else (id TEXT PRIMARY KEY)')
    database.close()
    const repair = new DesktopRecentsRepair(databasePath, join(root, 'backups'))

    const status = await repair.inspect(new Set())
    const result = await repair.removeThreadIds(new Set(['unknown']))

    expect(status.state).toBe('unavailable')
    expect(result.removed).toBe(0)
    expect(result.error).toMatch(/schema is not available/)
  })
})
