import { open } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RpcClientLike } from '@threadbox/core'
import type { ProjectRecord, ProjectSnapshot } from '../shared/contracts'

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function project(value: unknown, projectId: string): ProjectRecord | null {
  const entry = object(value)
  if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 4096) return null
  return {
    id: `official:${projectId}`,
    name: entry.name,
    kind: 'official',
    readOnly: true,
    createdAt: timestamp(entry.createdAt),
    updatedAt: timestamp(entry.updatedAt)
  }
}

function unsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /method not found/i.test(message) ||
    /(?:unknown method|unknown variant|unsupported method)[^\n]*project\/list/i.test(message)
}

export class DesktopProjects {
  constructor(private readonly client: Pick<RpcClientLike, 'request'>, private readonly codexHome: string) {}

  async list(): Promise<ProjectSnapshot> {
    const legacy = await this.readLegacyMetadata()
    const official = await this.listOfficialProjects()
    const projects = new Map((official ?? []).map((item) => [item.id, item]))
    const aliases = new Map<string, string>()
    const hostKey = `local:${resolve(this.codexHome)}`
    const normalizeHost = (value: string): string => process.platform === 'win32'
      ? value.replace(/\\/g, '/').toLowerCase() : value
    const localEntry = (value: unknown): JsonObject => {
      const entries = object(value)
      const key = Object.keys(entries).find((item) => normalizeHost(item) === normalizeHost(hostKey))
      return key ? object(entries[key]) : {}
    }
    const migratedIds = localEntry(legacy['app-server-project-id-by-legacy-project-id-by-host'])
    const migration = localEntry(legacy['app-server-projects-migration-by-host'])
    for (const [legacyId, value] of Object.entries(object(legacy['local-projects']))) {
      if (!id(legacyId)) continue
      const mappedId = migratedIds[legacyId]
      const canonicalId = id(mappedId) ? mappedId : `desktop:${legacyId}`
      const record = project(value, canonicalId)
      if (!record) continue
      // A project already migrated and subsequently deleted must not reappear.
      if (official !== null && id(mappedId) && !projects.has(record.id)) continue
      if (!projects.has(record.id)) projects.set(record.id, record)
      aliases.set(legacyId, record.id)
    }

    const assignments: Record<string, string> = Object.create(null)
    if (migration.threadAssignmentsMigrated !== true) {
      const projectless = new Set(Array.isArray(legacy['projectless-thread-ids'])
        ? legacy['projectless-thread-ids'].filter(id) : [])
      for (const [threadId, value] of Object.entries(object(legacy['thread-project-assignments']))) {
        const assignment = object(value)
        if (!id(threadId) || projectless.has(threadId) || assignment.projectKind !== 'local' || !id(assignment.projectId)) continue
        const target = aliases.get(assignment.projectId)
        if (target) assignments[threadId] = target
      }
    }
    const order = Array.isArray(legacy['project-order']) ? legacy['project-order'].filter(id) : []
    const orderedIds = [...new Set(order.map((key) => aliases.get(key)).filter((key): key is string => !!key))]
    const rank = new Map(orderedIds.map((key, index) => [key, index]))
    const records = [...projects.values()]
    if (migration.threadAssignmentsMigrated !== true) {
      records.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
    }
    return { projects: records, assignments, refreshedAt: Date.now() }
  }

  private async readLegacyMetadata(): Promise<JsonObject> {
    let file: Awaited<ReturnType<typeof open>> | undefined
    try {
      file = await open(join(this.codexHome, '.codex-global-state.json'), 'r')
      if ((await file.stat()).size > 8 * 1024 * 1024) throw new Error('Desktop project metadata is too large.')
      const state = object(JSON.parse(await file.readFile('utf8')))
      // Only project names, order and explicit membership leave this adapter.
      return Object.fromEntries([
        'local-projects', 'project-order', 'thread-project-assignments', 'projectless-thread-ids',
        'app-server-project-id-by-legacy-project-id-by-host', 'app-server-projects-migration-by-host'
      ].map((key) => [key, state[key]]))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new Error('Could not read Codex desktop project metadata. No files were changed.', { cause: error })
    } finally { await file?.close() }
  }

  private async listOfficialProjects(): Promise<ProjectRecord[] | null> {
    const projects: ProjectRecord[] = []
    const cursors = new Set<string>()
    let cursor: string | null = null
    do {
      let response: unknown
      try {
        response = await this.client.request('project/list', { cursor, limit: 100, sortKey: 'position' })
      } catch (error) {
        if (cursor === null && unsupported(error)) return null
        throw error
      }
      const page = object(response)
      if (!Array.isArray(page.data)) throw new Error('Codex returned an invalid project list.')
      for (const value of page.data) {
        const entry = object(value)
        if (!id(entry.id)) throw new Error('Codex returned an invalid project ID.')
        const record = project(entry, entry.id)
        if (!record) throw new Error('Codex returned an invalid project name.')
        projects.push(record)
      }
      if (page.nextCursor != null && typeof page.nextCursor !== 'string') throw new Error('Codex returned an invalid project cursor.')
      cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
      if (cursor && cursors.has(cursor)) throw new Error('Codex repeated a project pagination cursor.')
      if (cursor) cursors.add(cursor)
    } while (cursor)
    return projects
  }
}
