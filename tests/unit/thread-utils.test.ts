import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../../src/shared/contracts'
import { DEFAULT_FILTERS, filterThreads } from '../../src/renderer/src/thread-utils'

function record(overrides: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'thread-1',
    title: 'Release checklist',
    preview: 'Prepare artifacts',
    cwd: '/work/threadbox',
    createdAt: 1_000,
    updatedAt: 2_000,
    source: 'cli',
    archived: false,
    pinned: false,
    status: 'notLoaded',
    parentThreadId: null,
    descendantCount: 0,
    internal: false,
    ineligibleReason: null,
    ...overrides
  }
}

describe('filterThreads', () => {
  const rows = [
    record({ id: 'a', title: 'Alpha', updatedAt: 9_000 }),
    record({ id: 'b', title: 'Beta', cwd: '/work/other', archived: true, updatedAt: 8_000 }),
    record({ id: 'c', title: 'Hidden helper', internal: true, source: 'subAgent', updatedAt: 7_000 })
  ]

  it('hides internal tasks by default and searches all metadata', () => {
    expect(filterThreads(rows, DEFAULT_FILTERS).map((row) => row.id)).toEqual(['a', 'b'])
    expect(
      filterThreads(rows, { ...DEFAULT_FILTERS, query: '/work/other' }).map((row) => row.id)
    ).toEqual(['b'])
  })

  it('combines archive, source, directory and age filters', () => {
    const result = filterThreads(
      rows,
      {
        ...DEFAULT_FILTERS,
        archive: 'archived',
        directory: '/work/other',
        age: '7'
      },
      8_000 + 86_400
    )
    expect(result.map((row) => row.id)).toEqual(['b'])
  })

  it('sorts without mutating the source array', () => {
    const original = [...rows]
    const result = filterThreads(rows, { ...DEFAULT_FILTERS, sort: 'title-asc' })
    expect(result.map((row) => row.title)).toEqual(['Alpha', 'Beta'])
    expect(rows).toEqual(original)
  })
})
