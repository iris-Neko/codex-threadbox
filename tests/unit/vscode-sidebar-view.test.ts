// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../../src/shared/contracts'
import { DEFAULT_SIDEBAR_VIEW, parseSidebarView, sidebarMatches, sidebarOrder, selectionDetails, taskTooltip } from '../../packages/vscode/src/sidebar-view'
const task = (id: string, extra: Partial<ThreadRecord> = {}): ThreadRecord => ({
  id, title: id, cwd: '/work/app', preview: '', source: 'vscode', createdAt: 1, updatedAt: 2,
  archived: false, pinned: false, projectId: null, parentThreadId: null, status: 'notLoaded',
  descendantCount: 0, internal: false, ineligibleReason: null, ...extra
})
describe('Sidebar view filters', () => {
  it.each([
    ['C:\\Work\\App', 'c:/work/app/src', true], ['C:\\', 'c:/work/app', true],
    ['//HOST/share', '//host/SHARE/src', true], ['/work/app', '/work/app/src', true],
    ['/work/app', '/work/application', false], ['/work/app', '/WORK/app', false], ['/', '/work/app', true]
  ])('matches directory boundaries for %s and %s', (root, cwd, expected) => {
    expect(sidebarMatches([task('one', { cwd })], '', '', { ...DEFAULT_SIDEBAR_VIEW, scope: 'workspace' }, [root]).matches.has('one')).toBe(expected)
  })
  it('matches multiple roots and keeps spawned tasks scoped to their parent workspace', () => {
    const records = [task('root', { cwd: '/second' }), task('child', {
      cwd: '/elsewhere', parentThreadId: 'root', internal: true, source: 'subAgentThreadSpawn'
    }), task('unrelated', { cwd: '/outside' })]
    expect([...sidebarMatches(records, '', '', { ...DEFAULT_SIDEBAR_VIEW, scope: 'workspace' }, ['/first', '/second']).matches]).toEqual(['root', 'child'])
  })
  it('retains ancestors only as context without selecting them as search matches', () => {
    const records = [task('parent'), task('needle', { parentThreadId: 'parent', source: 'subAgentThreadSpawn', internal: true })]
    const result = sidebarMatches(records, 'needle', '', DEFAULT_SIDEBAR_VIEW, [])
    expect(result.threads.map((t) => t.id)).toEqual(['parent', 'needle'])
    expect([...result.matches]).toEqual(['needle'])
  })
  it('applies archive filters to regular projects but not to Trash', () => {
    const records = [task('active'), task('archived', { archived: true })]
    const options = { ...DEFAULT_SIDEBAR_VIEW, archive: 'active' as const }
    expect([...sidebarMatches(records, '', '', options, []).matches]).toEqual(['active'])
    expect([...sidebarMatches(records, '', '', options, [], true).matches]).toEqual(['active', 'archived'])
    expect([...sidebarMatches(records, '', '', { ...options, archive: 'archived' }, []).matches]).toEqual(['archived'])
  })
  it('resets malformed saved options and sorts predictably', () => {
    expect(parseSidebarView({ sort: 'bogus', scope: '../', archive: 12 })).toEqual(DEFAULT_SIDEBAR_VIEW)
    const records = [task('Z', { updatedAt: 20 }), task('A', { updatedAt: 10 })]
    expect(records.toSorted(sidebarOrder('updated-asc')).map((t) => t.id)).toEqual(['A', 'Z'])
    expect(records.toSorted(sidebarOrder('updated-desc')).map((t) => t.id)).toEqual(['Z', 'A'])
    expect(records.toSorted(sidebarOrder('title-asc')).map((t) => t.id)).toEqual(['A', 'Z'])
  })
  it('describes hidden descendants and complete metadata without conversation bodies', () => {
    const root = task('root')
    expect(selectionDetails([root, task('child', { parentThreadId: 'root' })], ['root'], false)).toContain('1 descendant')
    const tooltip = taskTooltip(root, 'en')
    for (const label of ['ID: root', 'Directory: /work/app', 'Created:', 'Updated:', 'Source: vscode', 'Not loaded']) expect(tooltip).toContain(label)
  })
})
