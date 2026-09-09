import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../../src/shared/contracts'
import { desktopInventory, deletionBlock, desktopNavigation } from '../../src/renderer/src/desktop-model'

function task(id: string, overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return { id, title: id, preview: '', cwd: '/work', projectId: null, createdAt: 0,
    updatedAt: 0, source: 'cli', archived: false, pinned: false, status: 'notLoaded',
    parentThreadId: null, descendantCount: 0, internal: false, ineligibleReason: null, ...overrides }
}

describe('desktop task families', () => {
  it('uses named projects and legacy membership even when thread projectId is null', () => {
    const projects = { projects: [
      { id: 'official:a', name: 'Product planning', kind: 'official' as const, readOnly: true, createdAt: null, updatedAt: null },
      { id: 'official:empty', name: 'Empty project', kind: 'official' as const, readOnly: true, createdAt: null, updatedAt: null }
    ], assignments: { legacy: 'official:a', canonical: 'official:a' }, refreshedAt: 0 }
    const rows = [task('legacy'), task('canonical', { projectId: 'b' }), task('unassigned')]
    const result = desktopNavigation(rows, projects)
    expect(result.projects[0]?.name).toBe('Product planning')
    expect(result.projects[0]?.threads.map((thread) => thread.id)).toEqual(['legacy'])
    expect(result.projects[1]?.threads).toEqual([])
    expect(result.projects[2]?.id).toBe('project:b')
    expect(result.standalone[0]?.threads.map((thread) => thread.id)).toEqual(['unassigned'])
    expect(rows[0]?.projectId).toBeNull()
  })
  it('separates official project identity from shared working directories', () => {
    const navigation = desktopNavigation([
      task('project-a', { projectId: 'a' }),
      task('project-b', { projectId: 'b' }),
      task('local'),
      task('standalone', { source: 'appServer' }),
      task('child', { internal: true, projectId: 'a', parentThreadId: 'project-a' })
    ])
    expect(navigation.projects.map((group) => group.id)).toEqual(['project:a', 'project:b'])
    expect(navigation.projects.map((group) => group.threads.length)).toEqual([1, 1])
    expect(navigation.directories).toHaveLength(1)
    expect(navigation.directories[0]?.threads.map((thread) => thread.id)).toEqual(['project-a', 'project-b', 'local', 'standalone'])
    expect(navigation.standalone[0]?.threads.map((thread) => thread.id)).toEqual(['local', 'standalone'])
  })
  it('hides linked agents and separates orphan families without losing normal forks', () => {
    const root = task('root')
    const child = task('child', { internal: true, parentThreadId: 'root' })
    const grandchild = task('grandchild', { internal: true, parentThreadId: 'child' })
    const orphan = task('orphan', { internal: true, parentThreadId: 'missing' })
    const orphanChild = task('orphan-child', { internal: true, parentThreadId: 'orphan' })
    const fork = task('fork', { parentThreadId: 'missing' })
    expect(desktopInventory([root, child, grandchild, orphan, orphanChild, fork])).toEqual({ tasks: [root, fork], orphaned: [orphan, orphanChild] })
  })
  it('protects the parent when any descendant is running or pinned', () => {
    const root = task('root')
    const child = task('child', { internal: true, parentThreadId: 'root' })
    for (const protection of [{ pinned: true }, { status: 'active' as const }]) {
      const leaf = task('leaf', { parentThreadId: 'child', internal: true, ...protection })
      expect(deletionBlock(root, [root, child, leaf])).toBe('descendant')
    }
    expect(deletionBlock(root, [root, child])).toBeNull()
    expect(deletionBlock(task('pinned', { pinned: true }), [])).toBe('pinned')
    expect(deletionBlock(task('running', { status: 'active' }), [])).toBe('active')
  })
  it('keeps cyclic and missing-parent internal metadata reachable', () => {
    const a = task('a', { internal: true, parentThreadId: 'b' })
    const b = task('b', { internal: true, parentThreadId: 'a' })
    expect(desktopInventory([a, b]).orphaned).toHaveLength(2)
  })
})
