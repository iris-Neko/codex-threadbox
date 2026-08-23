import type {
  BatchOperationResult,
  EnvironmentStatus,
  ThreadRecord
} from '../../../src/shared/contracts'
import type { ArchiveFilter, SortMode, ThreadFilters } from '../../core/src/thread-utils'
import { DEFAULT_FILTERS, filterThreads } from '../../core/src/thread-utils'

export interface ListOptions {
  state?: string
  source?: string
  cwd?: string
  search?: string
  sort?: string
}

export interface JsonEnvelope {
  schemaVersion: 1
  command: string
  success: boolean
  environment?: EnvironmentStatus
  records?: ThreadRecord[]
  result?: BatchOperationResult
  error?: { message: string }
}

const ARCHIVE_FILTERS = new Set<ArchiveFilter>(['all', 'active', 'archived'])
const SORT_MODES = new Set<SortMode>([
  'updated-desc',
  'updated-asc',
  'created-desc',
  'title-asc'
])

export function listFilters(options: ListOptions): ThreadFilters {
  const archive = (options.state ?? 'all') as ArchiveFilter
  const sort = (options.sort ?? 'updated-desc') as SortMode
  if (!ARCHIVE_FILTERS.has(archive)) {
    throw new Error('State must be one of: all, active, archived.')
  }
  if (!SORT_MODES.has(sort)) {
    throw new Error('Sort must be one of: updated-desc, updated-asc, created-desc, title-asc.')
  }
  return {
    ...DEFAULT_FILTERS,
    archive,
    source: options.source ?? 'all',
    directory: options.cwd ?? 'all',
    query: options.search ?? '',
    sort
  }
}

export function filterList(threads: ThreadRecord[], options: ListOptions): ThreadRecord[] {
  return filterThreads(threads, listFilters(options))
}

function clip(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width)
  return `${value.slice(0, Math.max(1, width - 3))}...`
}

export function formatThreadTable(threads: ThreadRecord[]): string {
  const headers = ['STATE', 'TITLE', 'SOURCE', 'UPDATED', 'ID', 'CWD']
  const rows = threads.map((thread) => [
    thread.status === 'active'
      ? 'running'
      : thread.archived
        ? 'archived'
        : thread.pinned
          ? 'pinned'
          : 'active',
    thread.title,
    thread.source,
    new Date(thread.updatedAt * 1000).toISOString(),
    thread.id,
    thread.cwd
  ])
  const widths = [9, 30, 14, 24, 36, 40]
  return [headers, ...rows]
    .map((row) => row.map((value, index) => clip(value, widths[index] ?? 20)).join('  ').trimEnd())
    .join('\n')
}

export function operationSucceeded(result: BatchOperationResult): boolean {
  return result.failed.length === 0 && result.skipped.length === 0
}

export function statusEnvelope(command: string, environment: EnvironmentStatus): JsonEnvelope {
  return {
    schemaVersion: 1,
    command,
    success: environment.state === 'ready',
    environment
  }
}

export function listEnvelope(
  command: string,
  environment: EnvironmentStatus,
  records: ThreadRecord[]
): JsonEnvelope {
  return { schemaVersion: 1, command, success: true, environment, records }
}

export function resultEnvelope(
  command: string,
  success: boolean,
  result: BatchOperationResult
): JsonEnvelope {
  return { schemaVersion: 1, command, success, result }
}

export function errorEnvelope(command: string, message: string): JsonEnvelope {
  return { schemaVersion: 1, command, success: false, error: { message } }
}
