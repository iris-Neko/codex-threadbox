import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type {
  DesktopRecentsCleanupResult,
  DesktopRecentsRepairResult,
  DesktopRecentsStatus
} from '../shared/contracts'

interface CatalogRow {
  thread_id: string
  display_title: string
}

interface IntegrityRow {
  integrity_check: string
}

interface ChangeResult {
  changes: number | bigint
}

interface StateThreadRow {
  id: string
  rollout_path: string
}

const MAX_REPORTED_ENTRIES = 200

export interface DesktopRecentsRepairLike {
  inspect(liveThreadIds: ReadonlySet<string>): Promise<DesktopRecentsStatus>
  repair(liveThreadIds: ReadonlySet<string>): Promise<DesktopRecentsRepairResult>
  removeThreadIds(threadIds: ReadonlySet<string>): Promise<DesktopRecentsCleanupResult>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailable(message: string | null = null): DesktopRecentsStatus {
  return {
    state: 'unavailable',
    staleCount: 0,
    staleEntries: [],
    message
  }
}

export class DesktopRecentsRepair implements DesktopRecentsRepairLike {
  constructor(
    private readonly databasePath: string,
    private readonly backupDirectory: string,
    private readonly taskStateDatabasePath?: string
  ) {}

  async inspect(liveThreadIds: ReadonlySet<string>): Promise<DesktopRecentsStatus> {
    let database: DatabaseSync | null = null
    try {
      if (!existsSync(this.databasePath)) return unavailable()
      const protectedIds = this.protectedThreadIds(liveThreadIds)
      database = new DatabaseSync(this.databasePath, { readOnly: true, timeout: 3_000 })
      if (!this.hasSupportedSchema(database)) {
        return unavailable('The Codex desktop Recents catalog schema is not available.')
      }

      const rows = database
        .prepare(`SELECT thread_id, display_title
          FROM local_thread_catalog
          WHERE host_id = 'local' AND missing_candidate = 0
          ORDER BY source_recency_at DESC, source_created_at DESC, thread_id`)
        .all() as unknown as CatalogRow[]
      const stale = rows.filter((row) => !protectedIds.has(row.thread_id))
      return {
        state: stale.length > 0 ? 'stale' : 'clean',
        staleCount: stale.length,
        staleEntries: stale.slice(0, MAX_REPORTED_ENTRIES).map((row) => ({
          id: row.thread_id,
          title: row.display_title
        })),
        message: null
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return unavailable()
      return {
        state: 'error',
        staleCount: 0,
        staleEntries: [],
        message: errorMessage(error)
      }
    } finally {
      database?.close()
    }
  }

  async repair(liveThreadIds: ReadonlySet<string>): Promise<DesktopRecentsRepairResult> {
    const status = await this.inspect(liveThreadIds)
    if (status.state !== 'stale') {
      return { removed: 0, backupPath: null, status }
    }

    let staleIds: Set<string>
    try {
      const protectedIds = this.protectedThreadIds(liveThreadIds)
      staleIds = new Set(
        this.readCatalogRows()
          .filter((row) => !protectedIds.has(row.thread_id))
          .map((row) => row.thread_id)
      )
    } catch (error) {
      return {
        removed: 0,
        backupPath: null,
        status: { ...status, state: 'error', message: errorMessage(error) }
      }
    }

    const cleanup = await this.removeThreadIds(staleIds)
    if (cleanup.error) {
      return {
        removed: cleanup.removed,
        backupPath: cleanup.backupPath,
        status: {
          state: 'error',
          staleCount: status.staleCount,
          staleEntries: status.staleEntries,
          message: cleanup.error
        }
      }
    }

    return {
      removed: cleanup.removed,
      backupPath: cleanup.backupPath,
      status: await this.inspect(liveThreadIds)
    }
  }

  async removeThreadIds(threadIds: ReadonlySet<string>): Promise<DesktopRecentsCleanupResult> {
    if (threadIds.size === 0) return { removed: 0, backupPath: null, error: null }

    let reader: DatabaseSync | null = null
    let writer: DatabaseSync | null = null
    let backupPath: string | null = null
    try {
      reader = new DatabaseSync(this.databasePath, { readOnly: true, timeout: 5_000 })
      if (!this.hasSupportedSchema(reader)) {
        return {
          removed: 0,
          backupPath: null,
          error: 'The Codex desktop Recents catalog schema is not available.'
        }
      }

      const existing = reader
        .prepare(`SELECT thread_id, display_title
          FROM local_thread_catalog
          WHERE host_id = 'local' AND missing_candidate = 0`)
        .all() as unknown as CatalogRow[]
      const targets = existing.filter((row) => threadIds.has(row.thread_id))
      if (targets.length === 0) return { removed: 0, backupPath: null, error: null }

      await mkdir(this.backupDirectory, { recursive: true })
      backupPath = join(this.backupDirectory, this.backupName())
      await backup(reader, backupPath)
      this.verifyBackup(backupPath)
      reader.close()
      reader = null

      writer = new DatabaseSync(this.databasePath, { timeout: 5_000 })
      if (!this.hasSupportedSchema(writer)) {
        throw new Error('The Codex desktop Recents catalog changed before repair.')
      }

      writer.exec('BEGIN IMMEDIATE')
      let removed = 0
      try {
        const statement = writer.prepare(`DELETE FROM local_thread_catalog
          WHERE host_id = 'local' AND thread_id = ? AND missing_candidate = 0`)
        for (const target of targets) {
          const result = statement.run(target.thread_id) as ChangeResult
          removed += Number(result.changes)
        }
        if (removed > 0 && this.hasTable(writer, 'local_thread_catalog_metadata')) {
          writer.exec(`UPDATE local_thread_catalog_metadata
            SET catalog_revision = catalog_revision + 1
            WHERE id = 1`)
        }
        writer.exec('COMMIT')
      } catch (error) {
        writer.exec('ROLLBACK')
        throw error
      }

      return { removed, backupPath, error: null }
    } catch (error) {
      return { removed: 0, backupPath, error: errorMessage(error) }
    } finally {
      reader?.close()
      writer?.close()
    }
  }

  private hasSupportedSchema(database: DatabaseSync): boolean {
    if (!this.hasTable(database, 'local_thread_catalog')) return false
    const columns = database.prepare('PRAGMA table_info(local_thread_catalog)').all() as Array<{
      name?: unknown
    }>
    const names = new Set(columns.map((column) => column.name).filter((name): name is string => typeof name === 'string'))
    return [
      'host_id',
      'thread_id',
      'display_title',
      'source_created_at',
      'source_recency_at',
      'missing_candidate'
    ].every((name) => names.has(name))
  }

  private readCatalogRows(): CatalogRow[] {
    const database = new DatabaseSync(this.databasePath, { readOnly: true, timeout: 3_000 })
    try {
      if (!this.hasSupportedSchema(database)) {
        throw new Error('The Codex desktop Recents catalog schema is not available.')
      }
      return database
        .prepare(`SELECT thread_id, display_title
          FROM local_thread_catalog
          WHERE host_id = 'local' AND missing_candidate = 0`)
        .all() as unknown as CatalogRow[]
    } finally {
      database.close()
    }
  }

  private protectedThreadIds(liveThreadIds: ReadonlySet<string>): Set<string> {
    const protectedIds = new Set(liveThreadIds)
    if (!this.taskStateDatabasePath || !existsSync(this.taskStateDatabasePath)) return protectedIds

    const database = new DatabaseSync(this.taskStateDatabasePath, { readOnly: true, timeout: 3_000 })
    try {
      if (!this.hasTable(database, 'threads')) return protectedIds
      const rows = database
        .prepare('SELECT id, rollout_path FROM threads')
        .all() as unknown as StateThreadRow[]
      for (const row of rows) {
        if (typeof row.id === 'string' && typeof row.rollout_path === 'string' && existsSync(row.rollout_path)) {
          protectedIds.add(row.id)
        }
      }
      return protectedIds
    } finally {
      database.close()
    }
  }

  private hasTable(database: DatabaseSync, table: string): boolean {
    return Boolean(
      database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
    )
  }

  private verifyBackup(path: string): void {
    const database = new DatabaseSync(path, { readOnly: true, timeout: 3_000 })
    try {
      const row = database.prepare('PRAGMA integrity_check').get() as IntegrityRow | undefined
      if (row?.integrity_check !== 'ok') throw new Error('The Codex catalog backup failed integrity verification.')
    } finally {
      database.close()
    }
  }

  private backupName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    return `${basename(this.databasePath, '.db')}-${timestamp}-${randomUUID().slice(0, 8)}.sqlite`
  }
}
