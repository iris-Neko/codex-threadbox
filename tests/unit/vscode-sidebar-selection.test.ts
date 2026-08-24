// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildVisibleThreadHierarchy,
  collectThreadIds,
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

  it('folds spawned tasks under visible parents and hides orphan internal tasks', () => {
    const hierarchy = buildVisibleThreadHierarchy([
      thread('parent', { updatedAt: 2 }),
      thread('child', { parentThreadId: 'parent', internal: true, updatedAt: 3 }),
      thread('orphan', { parentThreadId: 'missing', internal: true, updatedAt: 4 })
    ])

    expect(hierarchy.map((item) => item.thread.id)).toEqual(['parent'])
    expect(hierarchy[0]?.children.map((item) => item.thread.id)).toEqual(['child'])
  })
})
