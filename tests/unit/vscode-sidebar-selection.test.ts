// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  actionableRootIds,
  buildVisibleThreadHierarchy,
  collectThreadIds,
  filterSidebarThreads,
  manualMoveTargets,
  type ThreadTreeNode
} from '../../packages/vscode/src/sidebar-selection'
import type { ThreadRecord } from '../../src/shared/contracts'

function thread(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id, title: id, preview: '', cwd: '/work', projectId: null,
    createdAt: 1, updatedAt: 1, source: 'cli', archived: false, pinned: false,
    status: 'idle', parentThreadId: null, descendantCount: 0, internal: false,
    ineligibleReason: null, ...overrides
  }
}

describe('VS Code sidebar task selection', () => {
  it('collects every task below directory and archive groups', () => {
    const tree: ThreadTreeNode[] = [{
      children: [
        { thread: { id: 'root' }, children: [{ thread: { id: 'spawned' } }] },
        { children: [{ thread: { id: 'archived' } }] }
      ]
    }]

    expect(collectThreadIds(tree)).toEqual(['root', 'spawned', 'archived'])
  })

  it('deduplicates overlapping multi-selection', () => {
    const child: ThreadTreeNode = { thread: { id: 'child' } }
    const parent: ThreadTreeNode = { thread: { id: 'parent' }, children: [child] }

    expect(collectThreadIds([parent, child])).toEqual(['parent', 'child'])
  })

  it('reduces manual moves to roots and skips assignments already at the target', () => {
    const parent = thread('parent')
    const child = thread('child', { parentThreadId: 'parent', internal: true })
    const other = thread('other')

    expect(actionableRootIds(
      [parent, child, other],
      { parent: 'threadbox:alpha' },
      ['child', 'parent', 'other'],
      'threadbox:alpha'
    )).toEqual(['other'])
    expect(actionableRootIds(
      [parent, child, other],
      { parent: 'threadbox:alpha' },
      ['child', 'other'],
      null
    )).toEqual(['parent'])
  })

  it('builds sorted manual targets and only offers removal for assigned roots', () => {
    const projects = [
      { id: 'official', name: 'Official', kind: 'official' as const, readOnly: true,
        createdAt: null, updatedAt: null },
      { id: 'beta', name: 'Beta', kind: 'threadbox' as const, readOnly: false,
        createdAt: 1, updatedAt: 1 },
      { id: 'alpha', name: 'Alpha', kind: 'threadbox' as const, readOnly: false,
        createdAt: 1, updatedAt: 1 }
    ]

    expect(manualMoveTargets(projects, {}, ['root'])).toEqual([
      { kind: 'create' },
      { kind: 'project', projectId: 'alpha', name: 'Alpha' },
      { kind: 'project', projectId: 'beta', name: 'Beta' }
    ])
    expect(manualMoveTargets(projects, { root: 'alpha' }, ['root']).at(-1)).toEqual({ kind: 'remove' })
  })

  it('shows spawned agents under visible parents and hides system helper tasks', () => {
    const hierarchy = buildVisibleThreadHierarchy([
      thread('parent', { updatedAt: 2 }),
      thread('spawned', {
        parentThreadId: 'parent', internal: true, source: 'subAgentThreadSpawn', updatedAt: 3
      }),
      thread('guardian', {
        parentThreadId: 'parent', internal: true, source: 'subAgentOther', updatedAt: 5
      }),
      thread('review', {
        parentThreadId: 'parent', internal: true, source: 'subAgentReview', updatedAt: 4
      }),
      thread('compact', {
        parentThreadId: 'parent', internal: true, source: 'subAgentCompact', updatedAt: 4
      }),
      thread('orphan-spawned', {
        parentThreadId: 'missing', internal: true, source: 'subAgentThreadSpawn', updatedAt: 6
      })
    ])

    expect(hierarchy.map((item) => item.thread.id)).toEqual(['parent'])
    expect(hierarchy[0]?.children.map((item) => item.thread.id)).toEqual(['spawned'])
  })

  it('searches task metadata while retaining a matching spawned task parent', () => {
    const parent = thread('parent', { title: 'Release planning', cwd: '/work/product' })
    const child = thread('spawned', {
      title: 'Worker', preview: 'needle in the result', parentThreadId: 'parent',
      source: 'subAgentThreadSpawn', internal: true
    })
    const other = thread('other', { title: 'Unrelated' })

    expect(filterSidebarThreads([parent, child, other], 'needle').map((item) => item.id))
      .toEqual(['parent', 'spawned'])
    expect(filterSidebarThreads([parent, child, other], '/work/product').map((item) => item.id))
      .toEqual(['parent'])
  })

  it('shows a complete group when its project name matches and always hides system tasks', () => {
    const normal = thread('normal')
    const guardian = thread('guardian', { internal: true, source: 'subAgentOther' })
    const compact = thread('compact', { internal: true, source: 'subAgentCompact' })

    expect(filterSidebarThreads([normal, guardian, compact], 'focus', 'Focus Project')
      .map((item) => item.id)).toEqual(['normal'])
    expect(filterSidebarThreads([normal, guardian, compact], 'guardian', 'Focus Project'))
      .toEqual([])
  })
})
