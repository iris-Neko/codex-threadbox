import type { ProjectRecord, ThreadRecord } from '../../../src/shared/contracts'

export interface ThreadTreeNode {
  readonly thread?: Pick<ThreadRecord, 'id'>
  readonly children?: readonly ThreadTreeNode[]
}

export interface ThreadHierarchyNode extends ThreadTreeNode {
  readonly thread: ThreadRecord
  readonly children: ThreadHierarchyNode[]
}

export type ManualMoveTarget =
  | { kind: 'create' }
  | { kind: 'project'; projectId: string; name: string }
  | { kind: 'remove' }

function visibleThread(thread: ThreadRecord): boolean {
  return !thread.internal || thread.source === 'subAgentThreadSpawn'
}

function searchableText(thread: ThreadRecord): string {
  return [thread.title, thread.preview, thread.id, thread.source, thread.cwd]
    .join('\n')
    .toLocaleLowerCase()
}

export function filterSidebarThreads(
  threads: readonly ThreadRecord[],
  query: string,
  groupName = ''
): ThreadRecord[] {
  const normalized = query.trim().toLocaleLowerCase()
  const visible = threads.filter(visibleThread)
  if (!normalized || groupName.toLocaleLowerCase().includes(normalized)) return visible

  const byId = new Map(visible.map((thread) => [thread.id, thread]))
  const included = new Set<string>()
  for (const thread of visible) {
    if (!searchableText(thread).includes(normalized)) continue
    let current: ThreadRecord | undefined = thread
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      included.add(current.id)
      visited.add(current.id)
      current = current.parentThreadId ? byId.get(current.parentThreadId) : undefined
    }
  }
  return visible.filter((thread) => included.has(thread.id))
}

export function buildVisibleThreadHierarchy(threads: readonly ThreadRecord[]): ThreadHierarchyNode[] {
  const visible = threads.filter(visibleThread)
  const nodes = new Map(visible.map((thread) => [thread.id, { thread, children: [] } as ThreadHierarchyNode]))
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

export function selectedRootIds(threads: readonly ThreadRecord[], ids: readonly string[]): string[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const roots = new Set<string>()
  for (const id of ids) {
    let current = byId.get(id)
    if (!current) continue
    const visited = new Set<string>()
    while (current.parentThreadId && !visited.has(current.id)) {
      visited.add(current.id)
      const parent = byId.get(current.parentThreadId)
      if (!parent) break
      current = parent
    }
    roots.add(current.id)
  }
  return [...roots]
}

export function actionableRootIds(
  threads: readonly ThreadRecord[],
  assignments: Readonly<Record<string, string>>,
  ids: readonly string[],
  projectId: string | null
): string[] {
  return selectedRootIds(threads, ids).filter((id) => {
    const current = assignments[id]
    return projectId === null ? current !== undefined : current !== projectId
  })
}

export function manualMoveTargets(
  projects: readonly ProjectRecord[],
  assignments: Readonly<Record<string, string>>,
  rootIds: readonly string[]
): ManualMoveTarget[] {
  const targets: ManualMoveTarget[] = [
    { kind: 'create' },
    ...projects.filter((project) => project.kind === 'threadbox')
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((project) => ({
        kind: 'project' as const,
        projectId: project.id,
        name: project.name
      }))
  ]
  if (rootIds.some((id) => assignments[id] !== undefined)) targets.push({ kind: 'remove' })
  return targets
}
