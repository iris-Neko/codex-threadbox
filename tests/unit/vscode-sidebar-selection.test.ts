// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { collectThreadIds, type ThreadTreeNode } from '../../packages/vscode/src/sidebar-selection'

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
})
