import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadTable } from '../../packages/ui/src/components/ThreadTable'
import '../../packages/ui/src/i18n'
import type { ProjectRecord, ThreadRecord } from '../../src/shared/contracts'
import type { ThreadRowGroup, ThreadTreeRow } from '../../packages/ui/src/thread-utils'

afterEach(cleanup)

const thread: ThreadRecord = {
  id: 'trashed-task',
  title: 'Recover this task',
  preview: '',
  cwd: '/work/recover',
  projectId: null,
  createdAt: 1,
  updatedAt: 2,
  source: 'vscode',
  archived: true,
  pinned: false,
  status: 'idle',
  parentThreadId: null,
  descendantCount: 0,
  internal: false,
  ineligibleReason: null
}

const project: ProjectRecord = {
  id: 'threadbox:trash',
  name: 'Trash',
  kind: 'threadbox',
  systemKind: 'trash',
  readOnly: true,
  codexProjectId: null,
  roots: ['/work/recover'],
  canCreateThread: false,
  createThreadUnavailableReason: 'Tasks cannot be created directly in Trash.',
  createdAt: 1,
  updatedAt: 2
}

const row: ThreadTreeRow = {
  thread,
  depth: 0,
  hasChildren: false,
  expanded: false,
  matchesFilter: true
}

const group: ThreadRowGroup = {
  id: 'threadbox-project:threadbox:trash',
  kind: 'threadboxProject',
  projectId: project.id,
  project,
  name: project.name,
  directories: [thread.cwd],
  sources: [thread.source],
  threads: [thread],
  rows: [row],
  taskCount: 1,
  spawnedCount: 0
}

describe('ThreadTable Trash project', () => {
  it('offers restore and empty actions without editable project actions', () => {
    const restore = vi.fn()
    const empty = vi.fn()
    render(
      <ThreadTable
        rows={[row]}
        groups={[group]}
        collapsedGroups={new Set()}
        forceGroupsExpanded={false}
        selected={new Set()}
        implicitlySelected={new Set()}
        locale="en-US"
        allSelectableSelected={false}
        someSelectableSelected={false}
        allowOpenDirectory
        allowActiveSelection
        allowProjectThreadCreation
        taskTrash
        trashedThreadIds={new Set([thread.id])}
        projectMutationDisabled={false}
        onToggle={() => undefined}
        onToggleVisible={() => undefined}
        onToggleExpanded={() => undefined}
        onToggleGroup={() => undefined}
        onOpenDirectory={() => undefined}
        onCopyId={() => undefined}
        onArchive={() => undefined}
        onDelete={restore}
        onCreateThread={() => undefined}
        onRenameProject={() => undefined}
        onDeleteProject={() => undefined}
        onEmptyTrash={empty}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Restore from Trash' }))
    expect(restore).toHaveBeenCalledWith(thread)
    fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }))
    expect(empty).toHaveBeenCalledWith(project)
    expect(screen.queryByRole('button', { name: 'New task' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument()
  })
})
