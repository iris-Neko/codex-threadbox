import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopNavigation } from '../../src/renderer/src/DesktopNavigation'
import { desktopNavigation } from '../../src/renderer/src/desktop-model'
import type { ThreadRecord } from '../../src/shared/contracts'
import '../../packages/ui/src/i18n'

afterEach(cleanup)

it('expands project tasks separately from directory filters and supports collapse', () => {
  const task: ThreadRecord = { id: 'root', title: 'Project task', preview: '', cwd: '/work', projectId: 'official', createdAt: 0, updatedAt: 0, source: 'appServer', archived: false, pinned: false, status: 'idle', parentThreadId: null, descendantCount: 0, internal: false, ineligibleReason: null }
  const onScope = vi.fn()
  const onTask = vi.fn()
  render(<DesktopNavigation navigation={desktopNavigation([task], { projects: [{ id: 'official:official', name: 'work', kind: 'official', readOnly: true, createdAt: null, updatedAt: null }], assignments: {}, refreshedAt: 0 })} scope="all" count={1} onScope={onScope} onTask={onTask} />)
  const projects = within(screen.getByRole('region', { name: 'Projects' }))
  const directories = within(screen.getByRole('region', { name: 'Directories' }))
  expect(projects.queryByRole('button', { name: 'Project task' })).not.toBeInTheDocument()
  fireEvent.click(projects.getByRole('button', { name: 'work', exact: true }))
  expect(onScope).toHaveBeenCalledWith('project:official')
  fireEvent.click(projects.getByRole('button', { name: 'Project task' }))
  expect(onTask).toHaveBeenCalledWith('root')
  fireEvent.click(projects.getByRole('button', { name: 'Collapse project work' }))
  expect(projects.queryByRole('button', { name: 'Project task' })).not.toBeInTheDocument()
  fireEvent.click(directories.getByRole('button', { name: 'work', exact: true }))
  expect(onScope).toHaveBeenLastCalledWith('workspace:/work')
})
