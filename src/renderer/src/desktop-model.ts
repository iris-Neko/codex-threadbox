import type { ProjectSnapshot, ThreadRecord } from '../../shared/contracts'
import { groupThreads, owningThread, type ThreadGroup } from '../../../packages/core/src/thread-utils'

export function desktopNavigation(tasks: ThreadRecord[], snapshot?: ProjectSnapshot) {
  const mainTasks = tasks.filter((thread) => !thread.internal)
  const byId = new Map(mainTasks.map((thread) => [thread.id, thread]))
  const projects = new Map<string, ThreadGroup>()
  for (const record of snapshot?.projects ?? []) {
    if (record.kind !== 'official') continue
    projects.set(record.id, {
      id: `project:${record.id.slice('official:'.length)}`, kind: 'desktopProject',
      projectId: record.id, project: record, name: record.name,
      directories: [], sources: [], threads: []
    })
  }
  const unassigned: ThreadRecord[] = []
  for (const thread of mainTasks) {
    const owner = owningThread(thread, byId)
    const canonicalId = thread.projectId ?? owner.projectId
    const assignedId = canonicalId ? `official:${canonicalId}` : snapshot?.assignments[owner.id]
    if (!assignedId) { unassigned.push(thread); continue }
    let group = projects.get(assignedId)
    if (!group) {
      const rawId = assignedId.slice('official:'.length)
      group = { id: `project:${rawId}`, kind: 'desktopProject', projectId: assignedId,
        project: null, name: rawId, directories: [], sources: [], threads: [] }
      projects.set(assignedId, group)
    }
    group.threads.push(thread)
    if (!group.directories.includes(thread.cwd)) group.directories.push(thread.cwd)
    if (!group.sources.includes(thread.source)) group.sources.push(thread.source)
  }
  return {
    projects: [...projects.values()],
    directories: groupThreads(mainTasks, null, 'directories'),
    standalone: unassigned.length ? [{
      id: 'standalone', kind: 'standalone' as const, projectId: null, project: null,
      name: '', directories: [], sources: [], threads: unassigned
    }] : []
  }
}

export function desktopInventory(threads: ThreadRecord[]): { tasks: ThreadRecord[]; orphaned: ThreadRecord[] } {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  return {
    tasks: threads.filter((thread) => !thread.internal),
    orphaned: threads.filter((thread) => thread.internal && owningThread(thread, byId).internal)
  }
}

type DeletionBlock = 'active' | 'pinned' | 'descendant'

export function desktopDeletionBlocks(inventory: ThreadRecord[]): Map<string, DeletionBlock> {
  const byId = new Map(inventory.map((thread) => [thread.id, thread]))
  const blocks = new Map<string, DeletionBlock>()
  for (const thread of inventory) {
    if (thread.status !== 'active' && !thread.pinned) continue
    blocks.set(thread.id, thread.status === 'active' ? 'active' : 'pinned')
    const visited = new Set([thread.id])
    let parent = thread.parentThreadId
    while (parent && !visited.has(parent)) {
      visited.add(parent)
      if (!blocks.has(parent)) blocks.set(parent, 'descendant')
      parent = byId.get(parent)?.parentThreadId ?? null
    }
  }
  return blocks
}

export function deletionBlock(thread: ThreadRecord, inventory: ThreadRecord[]): DeletionBlock | null {
  if (thread.status === 'active') return 'active'
  if (thread.pinned) return 'pinned'
  return desktopDeletionBlocks(inventory).get(thread.id) ?? null
}
