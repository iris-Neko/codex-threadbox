import type { ThreadRecord } from '../../../src/shared/contracts'

export interface ThreadTreeNode {
  readonly thread?: Pick<ThreadRecord, 'id'>
  readonly children?: readonly ThreadTreeNode[]
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
