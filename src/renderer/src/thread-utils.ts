import type { ThreadRecord } from '../../shared/contracts'

export type ArchiveFilter = 'all' | 'active' | 'archived'
export type AgeFilter = 'all' | '7' | '30' | '90'
export type SortMode = 'updated-desc' | 'updated-asc' | 'created-desc' | 'title-asc'

export interface ThreadFilters {
  query: string
  archive: ArchiveFilter
  source: string
  directory: string
  age: AgeFilter
  sort: SortMode
  showInternal: boolean
}

export const DEFAULT_FILTERS: ThreadFilters = {
  query: '',
  archive: 'all',
  source: 'all',
  directory: 'all',
  age: 'all',
  sort: 'updated-desc',
  showInternal: false
}

export function filterThreads(
  threads: ThreadRecord[],
  filters: ThreadFilters,
  nowSeconds = Math.floor(Date.now() / 1000)
): ThreadRecord[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const ageSeconds = filters.age === 'all' ? null : Number(filters.age) * 86_400

  const filtered = threads.filter((thread) => {
    if (!filters.showInternal && thread.internal) return false
    if (filters.archive === 'active' && thread.archived) return false
    if (filters.archive === 'archived' && !thread.archived) return false
    if (filters.source !== 'all' && thread.source !== filters.source) return false
    if (filters.directory !== 'all' && thread.cwd !== filters.directory) return false
    if (ageSeconds !== null && nowSeconds - thread.updatedAt > ageSeconds) return false
    if (!query) return true

    return [thread.title, thread.preview, thread.cwd, thread.source, thread.id]
      .join('\n')
      .toLocaleLowerCase()
      .includes(query)
  })

  return filtered.toSorted((left, right) => {
    switch (filters.sort) {
      case 'updated-asc':
        return left.updatedAt - right.updatedAt
      case 'created-desc':
        return right.createdAt - left.createdAt
      case 'title-asc':
        return left.title.localeCompare(right.title)
      default:
        return right.updatedAt - left.updatedAt
    }
  })
}

export function formatTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp * 1000))
}

export function deletableThreads(threads: ThreadRecord[]): ThreadRecord[] {
  return threads.filter((thread) => thread.status !== 'active' && !thread.pinned)
}
