import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../../src/shared/contracts'
import {
  DEFAULT_FILTERS,
  deselectThreadSubtrees,
  filterThreads,
  flattenThreadTree,
  groupThreadRows,
  groupThreads,
  resolveThreadSelection,
  selectThreadRoots,
  toggleThreadSelection
} from '../../packages/core/src/thread-utils'

function record(overrides: Partial<ThreadRecord>): ThreadRecord {
  return {
    id: 'thread-1',
    title: 'Release checklist',
    preview: 'Prepare artifacts',
    cwd: '/work/threadbox',
    projectId: null,
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

  it('includes spawned tasks in filtered metadata results', () => {
    expect(filterThreads(rows, DEFAULT_FILTERS).map((row) => row.id)).toEqual(['a', 'b', 'c'])
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
    expect(result.map((row) => row.title)).toEqual(['Alpha', 'Beta', 'Hidden helper'])
    expect(rows).toEqual(original)
  })

  it('groups desktop projects, local workspaces and standalone desktop tasks', () => {
    const desktopProject = record({
      id: 'project-task',
      projectId: 'project-1',
      source: 'appServer',
      cwd: '/work/product'
    })
    const vscode = record({ id: 'vscode', source: 'vscode', cwd: '/work/product' })
    const cli = record({ id: 'cli', source: 'cli', cwd: '/work/product' })
    const standalone = record({ id: 'standalone', source: 'appServer', cwd: '/generated/task' })
    const groups = groupThreads([desktopProject, vscode, cli, standalone])

    expect(groups.map((group) => [group.id, group.kind, group.threads.map((item) => item.id)])).toEqual([
      ['project:project-1', 'desktopProject', ['project-task']],
      ['workspace:/work/product', 'localWorkspace', ['vscode', 'cli']],
      ['standalone', 'standalone', ['standalone']]
    ])
  })

  it('normalizes Windows workspace paths for grouping', () => {
    const vscode = record({ id: 'vscode', source: 'vscode', cwd: 'C:\\Work\\Product' })
    const cli = record({ id: 'cli', source: 'cli', cwd: 'c:\\work\\product\\' })

    const groups = groupThreads([vscode, cli])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.threads.map((thread) => thread.id)).toEqual(['vscode', 'cli'])
  })

  it('keeps spawned descendants in their parent group and groups visible tree rows', () => {
    const parent = record({ id: 'parent', source: 'vscode', cwd: '/work/app' })
    const child = record({
      id: 'child',
      source: 'subAgent',
      cwd: '/work/child-runtime',
      parentThreadId: 'parent',
      internal: true
    })
    const rows = flattenThreadTree([parent, child], [parent, child], new Set(['parent']))
    const groups = groupThreadRows([child, parent], rows)

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: 'workspace:/work/app',
      name: 'app',
      taskCount: 1,
      spawnedCount: 1
    })
    expect(groups[0]!.rows.map((row) => row.thread.id)).toEqual(['parent', 'child'])
  })

  it('folds spawned tasks under parents and expands nested levels on demand', () => {
    const parent = record({ id: 'parent', title: 'Parent', updatedAt: 9_000, descendantCount: 2 })
    const child = record({
      id: 'child',
      title: 'Child',
      parentThreadId: 'parent',
      internal: true,
      updatedAt: 8_000,
      descendantCount: 1
    })
    const grandchild = record({
      id: 'grandchild',
      title: 'Grandchild',
      parentThreadId: 'child',
      internal: true,
      updatedAt: 7_000
    })
    const root = record({ id: 'root', title: 'Root', updatedAt: 6_000 })
    const all = [parent, child, grandchild, root]

    expect(flattenThreadTree(all, all, new Set()).map((row) => row.thread.id)).toEqual([
      'parent',
      'root'
    ])
    expect(
      flattenThreadTree(all, all, new Set(['parent', 'child'])).map((row) => [
        row.thread.id,
        row.depth
      ])
    ).toEqual([
      ['parent', 0],
      ['child', 1],
      ['grandchild', 2],
      ['root', 0]
    ])
  })

  it('reveals the parent chain when search matches a spawned task', () => {
    const parent = record({ id: 'parent', title: 'Parent', descendantCount: 1 })
    const child = record({
      id: 'child',
      title: 'Needle child',
      parentThreadId: 'parent',
      internal: true
    })
    const matches = filterThreads([parent, child], { ...DEFAULT_FILTERS, query: 'needle' })
    const tree = flattenThreadTree([parent, child], matches, new Set(), true)

    expect(tree.map((row) => [row.thread.id, row.depth, row.matchesFilter])).toEqual([
      ['parent', 0, false],
      ['child', 1, true]
    ])
  })

  it('selects descendants implicitly and normalizes selected roots', () => {
    const parent = record({ id: 'parent' })
    const child = record({ id: 'child', parentThreadId: 'parent' })
    const grandchild = record({ id: 'grandchild', parentThreadId: 'child' })
    const root = record({ id: 'root' })
    const all = [parent, child, grandchild, root]

    const selection = resolveThreadSelection(all, ['grandchild', 'parent', 'root'])
    expect([...selection.roots]).toEqual(['parent', 'root'])
    expect(selection.effective).toEqual(new Set(['parent', 'root', 'child', 'grandchild']))
    expect(selection.implicit).toEqual(new Set(['child', 'grandchild']))
  })

  it('clears a selected subtree while still allowing a child to be selected alone', () => {
    const parent = record({ id: 'parent' })
    const child = record({ id: 'child', parentThreadId: 'parent' })
    const all = [parent, child]

    expect(toggleThreadSelection(all, new Set(), 'child')).toEqual(new Set(['child']))
    expect(toggleThreadSelection(all, new Set(['child']), 'parent')).toEqual(new Set(['parent']))
    expect(toggleThreadSelection(all, new Set(['parent']), 'child')).toEqual(new Set(['parent']))
    expect(toggleThreadSelection(all, new Set(['parent']), 'parent')).toEqual(new Set())
  })

  it('normalizes select-visible and clears roots that cover deselected visible tasks', () => {
    const parent = record({ id: 'parent' })
    const child = record({ id: 'child', parentThreadId: 'parent' })
    const sibling = record({ id: 'sibling' })
    const all = [parent, child, sibling]

    expect(selectThreadRoots(all, new Set(['child']), ['parent', 'sibling'])).toEqual(
      new Set(['parent', 'sibling'])
    )
    expect(deselectThreadSubtrees(all, new Set(['parent', 'sibling']), ['child'])).toEqual(
      new Set(['sibling'])
    )
  })
})
