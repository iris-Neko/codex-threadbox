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
})
