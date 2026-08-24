import stringWidth from 'string-width'
import type {
  BatchOperationResult,
  DeletePreview,
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
  includeSpawned?: boolean
}

export interface JsonEnvelope {
  schemaVersion: 1
  command: string
  success: boolean
  environment?: EnvironmentStatus
  records?: ThreadRecord[]
  result?: BatchOperationResult
  preview?: DeletePreview
  dryRun?: true
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
    .filter((thread) => options.includeSpawned || !thread.internal)
}

function clip(value: string, width: number): string {
  if (stringWidth(value) <= width) return `${value}${' '.repeat(width - stringWidth(value))}`
  const target = Math.max(1, width - 3)
  let clipped = ''
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(value)) {
    if (stringWidth(clipped + segment) > target) break
    clipped += segment
  }
  const result = `${clipped}...`
  return `${result}${' '.repeat(Math.max(0, width - stringWidth(result)))}`
}

export function formatThreadTable(
  threads: ThreadRecord[],
  terminalWidth = process.stdout.columns ?? 160
): string {
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
  const fixedWidths = terminalWidth >= 145 ? [9, 14, 24, 36] : [9, 12, 19, 12]
  const flexible = Math.max(36, terminalWidth - fixedWidths.reduce((sum, width) => sum + width, 0) - 10)
  const titleWidth = Math.min(36, Math.max(16, Math.floor(flexible * 0.45)))
  const cwdWidth = Math.min(60, Math.max(20, flexible - titleWidth))
  const widths = [fixedWidths[0]!, titleWidth, fixedWidths[1]!, fixedWidths[2]!, fixedWidths[3]!, cwdWidth]
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
  result: BatchOperationResult,
  preview?: DeletePreview
): JsonEnvelope {
  return { schemaVersion: 1, command, success, result, ...(preview ? { preview } : {}) }
}

export function previewEnvelope(command: string, preview: DeletePreview): JsonEnvelope {
  return {
    schemaVersion: 1,
    command,
    success: preview.skipped.length === 0 && preview.roots.length > 0,
    preview,
    dryRun: true
  }
}

export function errorEnvelope(command: string, message: string): JsonEnvelope {
  return { schemaVersion: 1, command, success: false, error: { message } }
}
