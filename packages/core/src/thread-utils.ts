import type { ProjectRecord, ProjectSnapshot, ThreadRecord } from '../../../src/shared/contracts'

export type ArchiveFilter = 'all' | 'active' | 'archived'
export type AgeFilter = 'all' | '7' | '30' | '90'
export type SortMode = 'updated-desc' | 'updated-asc' | 'created-desc' | 'title-asc'
export type ThreadViewMode = 'projects' | 'directories' | 'flat'
export type ThreadGroupKind = 'threadboxProject' | 'desktopProject' | 'localWorkspace' | 'standalone'

export interface ThreadFilters {
  query: string
  archive: ArchiveFilter
  source: string
  directory: string
  workspace: string
  age: AgeFilter
  sort: SortMode
}

export interface ThreadTreeRow {
  thread: ThreadRecord
  depth: number
  hasChildren: boolean
  expanded: boolean
  matchesFilter: boolean
}

export interface ThreadSelection {
  roots: Set<string>
  effective: Set<string>
  implicit: Set<string>
}

export interface ThreadGroup {
  id: string
  kind: ThreadGroupKind
  projectId: string | null
  project: ProjectRecord | null
  name: string
  directories: string[]
  sources: string[]
  threads: ThreadRecord[]
}

export interface ThreadRowGroup extends ThreadGroup {
  rows: ThreadTreeRow[]
  taskCount: number
  spawnedCount: number
}

export const DEFAULT_FILTERS: ThreadFilters = {
  query: '',
  archive: 'all',
  source: 'all',
  directory: 'all',
  workspace: 'all',
  age: 'all',
  sort: 'updated-desc'
}

function directoryName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function directoryKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const windowsStyle = /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
  return windowsStyle ? normalized.toLocaleLowerCase() : normalized
}

export function owningThread(thread: ThreadRecord, byId: Map<string, ThreadRecord>): ThreadRecord {
  let owner = thread
  const visited = new Set<string>([thread.id])
  while (owner.parentThreadId && !visited.has(owner.parentThreadId)) {
    const parent = byId.get(owner.parentThreadId)
    if (!parent) break
    visited.add(parent.id)
    owner = parent
  }
  return owner
}

function groupIdentity(
  thread: ThreadRecord,
  byId: Map<string, ThreadRecord>,
  projects: ProjectSnapshot | null,
  mode: Exclude<ThreadViewMode, 'flat'>
): {
  id: string
  kind: ThreadGroupKind
  projectId: string | null
  project: ProjectRecord | null
  directory: string
} {
  const owner = owningThread(thread, byId)
  if (mode === 'directories') {
    return {
      id: `workspace:${directoryKey(owner.cwd)}`,
      kind: 'localWorkspace',
      projectId: null,
      project: null,
      directory: owner.cwd
    }
  }
  const assignedProjectId = projects?.assignments[owner.id]
  const assignedProject = assignedProjectId
    ? projects?.projects.find((project) => project.kind === 'threadbox' && project.id === assignedProjectId)
    : null
  if (assignedProject) {
    return {
      id: `threadbox-project:${assignedProject.id}`,
      kind: 'threadboxProject',
      projectId: assignedProject.id,
      project: assignedProject,
      directory: owner.cwd
    }
  }
  const projectId = thread.projectId ?? owner.projectId
  if (projectId) {
    const officialId = `official:${projectId}`
    const project = projects?.projects.find((item) => item.id === officialId) ?? null
    return {
      id: `project:${projectId}`,
      kind: 'desktopProject',
      projectId: officialId,
      project,
      directory: owner.cwd
    }
  }
  if (owner.source === 'appServer' && projects === null) {
    return {
      id: 'standalone',
      kind: 'standalone',
      projectId: null,
      project: null,
      directory: owner.cwd
    }
  }
  return {
    id: `workspace:${directoryKey(owner.cwd)}`,
    kind: 'localWorkspace',
    projectId: null,
    project: null,
    directory: owner.cwd
  }
}

export function groupThreads(
  threads: ThreadRecord[],
  projects: ProjectSnapshot | null = null,
  mode: Exclude<ThreadViewMode, 'flat'> = 'projects'
): ThreadGroup[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const groups = new Map<string, ThreadGroup>()

  for (const thread of threads) {
    const { directory, ...identity } = groupIdentity(thread, byId, projects, mode)
    let group = groups.get(identity.id)
    if (!group) {
      group = {
        ...identity,
        name: identity.project?.name ?? (identity.kind === 'standalone' ? '' : directoryName(directory)),
        directories: [],
        sources: [],
        threads: []
      }
      groups.set(identity.id, group)
    }
    group.threads.push(thread)
    if (
      !thread.internal &&
      !group.directories.some((directory) => directoryKey(directory) === directoryKey(thread.cwd))
    ) {
      group.directories.push(thread.cwd)
    }
    if (!thread.internal && !group.sources.includes(thread.source)) group.sources.push(thread.source)
  }

  if (mode === 'projects' && projects) {
    for (const project of projects.projects.filter((item) => item.kind === 'threadbox')) {
      const id = `threadbox-project:${project.id}`
      if (groups.has(id)) continue
      groups.set(id, {
        id,
        kind: 'threadboxProject',
        projectId: project.id,
        project,
        name: project.name,
        directories: [],
        sources: [],
        threads: []
      })
    }
  }

  return [...groups.values()]
}

export function groupThreadRows(
  allThreads: ThreadRecord[],
  rows: ThreadTreeRow[],
  projects: ProjectSnapshot | null = null,
  mode: Exclude<ThreadViewMode, 'flat'> = 'projects'
): ThreadRowGroup[] {
  const groupByThreadId = new Map<string, ThreadGroup>()
  const groups = groupThreads(allThreads, projects, mode)
  for (const group of groups) {
    for (const thread of group.threads) groupByThreadId.set(thread.id, group)
  }

  const rowsByGroup = new Map<string, ThreadTreeRow[]>()
  for (const row of rows) {
    const group = groupByThreadId.get(row.thread.id)
    if (!group) continue
    const groupedRows = rowsByGroup.get(group.id) ?? []
    groupedRows.push(row)
    rowsByGroup.set(group.id, groupedRows)
  }

  return groups.flatMap((group) => {
    const groupedRows = rowsByGroup.get(group.id)
    if (!groupedRows && (group.kind !== 'threadboxProject' || group.threads.length > 0)) return []
    return [{
      ...group,
      rows: groupedRows ?? [],
      taskCount: (groupedRows ?? []).filter((row) => row.matchesFilter && !row.thread.internal).length,
      spawnedCount: (groupedRows ?? []).filter((row) => row.matchesFilter && row.thread.internal).length
    }]
  })
}

function threadMaps(threads: ThreadRecord[]): {
  byId: Map<string, ThreadRecord>
  children: Map<string, string[]>
} {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const children = new Map<string, string[]>()

  for (const thread of threads) {
    if (!thread.parentThreadId || !byId.has(thread.parentThreadId)) continue
    const siblings = children.get(thread.parentThreadId) ?? []
    siblings.push(thread.id)
    children.set(thread.parentThreadId, siblings)
  }

  return { byId, children }
}

export function resolveThreadSelection(
  threads: ThreadRecord[],
  selectedIds: Iterable<string>
): ThreadSelection {
  const { byId, children } = threadMaps(threads)
  const candidates = new Set([...selectedIds].filter((id) => byId.has(id)))
  const roots = new Set<string>()

  for (const id of candidates) {
    const visited = new Set<string>()
    let parentId = byId.get(id)?.parentThreadId ?? null
    let hasSelectedAncestor = false
    while (parentId && !visited.has(parentId)) {
      if (candidates.has(parentId)) {
        hasSelectedAncestor = true
        break
      }
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentThreadId ?? null
    }
    if (!hasSelectedAncestor) roots.add(id)
  }

  const effective = new Set(roots)
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) continue
    for (const childId of children.get(id) ?? []) {
      if (effective.has(childId)) continue
      effective.add(childId)
      queue.push(childId)
    }
  }

  return {
    roots,
    effective,
    implicit: new Set([...effective].filter((id) => !roots.has(id)))
  }
}

export function toggleThreadSelection(
  threads: ThreadRecord[],
  selectedRoots: Iterable<string>,
  id: string
): Set<string> {
  const current = resolveThreadSelection(threads, selectedRoots)
  if (current.implicit.has(id)) return current.roots

  const next = new Set(current.roots)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return resolveThreadSelection(threads, next).roots
}

export function selectThreadRoots(
  threads: ThreadRecord[],
  selectedRoots: Iterable<string>,
  ids: Iterable<string>
): Set<string> {
  return resolveThreadSelection(threads, [...selectedRoots, ...ids]).roots
}

export function deselectThreadSubtrees(
  threads: ThreadRecord[],
  selectedRoots: Iterable<string>,
  ids: Iterable<string>
): Set<string> {
  const targets = new Set(ids)
  const current = resolveThreadSelection(threads, selectedRoots)
  const retained = [...current.roots].filter((rootId) => {
    const subtree = resolveThreadSelection(threads, [rootId]).effective
    return ![...targets].some((id) => subtree.has(id))
  })
  return new Set(retained)
}

export function filterThreads(
  threads: ThreadRecord[],
  filters: ThreadFilters,
  nowSeconds = Math.floor(Date.now() / 1000),
  currentWorkspaceDirectories: string[] = [],
  projects: ProjectSnapshot | null = null,
  groupMode: Exclude<ThreadViewMode, 'flat'> = 'projects'
): ThreadRecord[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const ageSeconds = filters.age === 'all' ? null : Number(filters.age) * 86_400
  const workspaceByThreadId = new Map<string, string>()
  const groupNameByThreadId = new Map<string, string>()
  const groups = groupThreads(threads, projects, groupMode)
  for (const group of groups) {
    for (const thread of group.threads) {
      workspaceByThreadId.set(thread.id, group.id)
      groupNameByThreadId.set(thread.id, group.name)
    }
  }

  const filtered = threads.filter((thread) => {
    if (filters.archive === 'active' && thread.archived) return false
    if (filters.archive === 'archived' && !thread.archived) return false
    if (filters.source !== 'all' && thread.source !== filters.source) return false
    if (filters.directory !== 'all' && thread.cwd !== filters.directory) return false
    if (filters.workspace === '__current__') {
      const cwd = directoryKey(thread.cwd)
      const current = currentWorkspaceDirectories.some((directory) => {
        const workspace = directoryKey(directory)
        return cwd === workspace || cwd.startsWith(`${workspace}/`)
      })
      if (!current) return false
    } else if (filters.workspace !== 'all' && workspaceByThreadId.get(thread.id) !== filters.workspace) {
      return false
    }
    if (ageSeconds !== null && nowSeconds - thread.updatedAt > ageSeconds) return false
    if (!query) return true

    return [thread.title, thread.preview, thread.cwd, thread.source, thread.id,
      thread.projectId ?? '', groupNameByThreadId.get(thread.id) ?? '']
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

export function flattenThreadTree(
  allThreads: ThreadRecord[],
  matchedThreads: ThreadRecord[],
  expandedIds: Set<string>,
  expandMatchingAncestors = false,
  collapsedIds: Set<string> = new Set()
): ThreadTreeRow[] {
  const byId = new Map(allThreads.map((thread) => [thread.id, thread]))
  const allChildren = new Map<string, ThreadRecord[]>()
  const allOrder = new Map(allThreads.map((thread, index) => [thread.id, index]))
  const matchOrder = new Map(matchedThreads.map((thread, index) => [thread.id, index]))
  const matchedIds = new Set(matchedThreads.map((thread) => thread.id))
  const includedIds = new Set(matchedIds)
  const autoExpanded = new Set<string>()

  for (const thread of allThreads) {
    if (!thread.parentThreadId || !byId.has(thread.parentThreadId)) continue
    const siblings = allChildren.get(thread.parentThreadId) ?? []
    siblings.push(thread)
    allChildren.set(thread.parentThreadId, siblings)
  }

  for (const match of matchedThreads) {
    const descendantQueue = [...(allChildren.get(match.id) ?? [])]
    while (descendantQueue.length > 0) {
      const descendant = descendantQueue.shift()
      if (!descendant || includedIds.has(descendant.id)) continue
      includedIds.add(descendant.id)
      descendantQueue.push(...(allChildren.get(descendant.id) ?? []))
    }

    const visited = new Set<string>()
    let parentId = match.parentThreadId
    while (parentId && !visited.has(parentId)) {
      const parent = byId.get(parentId)
      if (!parent) break
      visited.add(parentId)
      includedIds.add(parentId)
      if (expandMatchingAncestors || !matchedIds.has(parentId)) autoExpanded.add(parentId)
      parentId = parent.parentThreadId
    }
  }

  const includedChildren = new Map<string, ThreadRecord[]>()
  const roots: ThreadRecord[] = []
  for (const thread of allThreads) {
    if (!includedIds.has(thread.id)) continue
    if (thread.parentThreadId && includedIds.has(thread.parentThreadId)) {
      const siblings = includedChildren.get(thread.parentThreadId) ?? []
      siblings.push(thread)
      includedChildren.set(thread.parentThreadId, siblings)
    } else {
      roots.push(thread)
    }
  }

  const sortThreads = (left: ThreadRecord, right: ThreadRecord): number => {
    const leftRank = matchOrder.get(left.id) ?? matchedThreads.length + (allOrder.get(left.id) ?? 0)
    const rightRank = matchOrder.get(right.id) ?? matchedThreads.length + (allOrder.get(right.id) ?? 0)
    return leftRank - rightRank
  }
  roots.sort(sortThreads)
  for (const children of includedChildren.values()) children.sort(sortThreads)

  const rows: ThreadTreeRow[] = []
  const rendered = new Set<string>()
  const visit = (thread: ThreadRecord, depth: number): void => {
    if (rendered.has(thread.id)) return
    rendered.add(thread.id)
    const children = includedChildren.get(thread.id) ?? []
    const expanded =
      children.length > 0 &&
      !collapsedIds.has(thread.id) &&
      (expandedIds.has(thread.id) || autoExpanded.has(thread.id))
    rows.push({
      thread,
      depth,
      hasChildren: children.length > 0,
      expanded,
      matchesFilter: matchedIds.has(thread.id)
    })
    if (expanded) children.forEach((child) => visit(child, depth + 1))
  }
  roots.forEach((root) => visit(root, 0))
  return rows
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
