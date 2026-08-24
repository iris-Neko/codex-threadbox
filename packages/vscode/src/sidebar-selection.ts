import type { ThreadRecord } from '../../../src/shared/contracts'

export interface ThreadTreeNode {
  readonly thread?: Pick<ThreadRecord, 'id'>
  readonly children?: readonly ThreadTreeNode[]
}

export interface ThreadHierarchyNode extends ThreadTreeNode {
  readonly thread: ThreadRecord
  readonly children: ThreadHierarchyNode[]
}

export function buildVisibleThreadHierarchy(threads: readonly ThreadRecord[]): ThreadHierarchyNode[] {
  const nodes = new Map(threads.map((thread) => [thread.id, { thread, children: [] } as ThreadHierarchyNode]))
  const roots: ThreadHierarchyNode[] = []
  for (const node of nodes.values()) {
    const parent = node.thread.parentThreadId ? nodes.get(node.thread.parentThreadId) : undefined
    if (parent) parent.children.push(node)
    else if (!node.thread.internal) roots.push(node)
  }
  const sort = (items: ThreadHierarchyNode[]): ThreadHierarchyNode[] => items
    .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)
    .map((item) => ({ ...item, children: sort(item.children) }))
  return sort(roots)
}

export function collectThreadIds(items: readonly ThreadTreeNode[]): string[] {
  const ids = new Set<string>()
  const visit = (item: ThreadTreeNode): void => {
    if (item.thread) ids.add(item.thread.id)
    for (const child of item.children ?? []) visit(child)
  }
  for (const item of items) visit(item)
  return [...ids]
}
