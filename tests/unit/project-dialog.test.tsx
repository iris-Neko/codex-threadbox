import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDialog } from '../../packages/ui/src/components/ProjectDialog'
import '../../packages/ui/src/i18n'

afterEach(cleanup)

describe('ProjectDialog', () => {
  it('defaults new projects to Codex when official project management is available', () => {
    const submit = vi.fn()
    render(
      <ProjectDialog
        allowOfficial
        busy={false}
        onClose={() => undefined}
        onSubmit={submit}
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Shared project' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(submit).toHaveBeenCalledWith('Shared project', 'official')
  })

  it('allows creating a Threadbox-only project and keeps rename kind fixed', () => {
    const create = vi.fn()
    const view = render(
      <ProjectDialog
        allowOfficial
        busy={false}
        onClose={() => undefined}
        onSubmit={create}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Threadbox project' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Local group' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(create).toHaveBeenCalledWith('Local group', 'threadbox')

    view.unmount()
    const rename = vi.fn()
    render(
      <ProjectDialog
        initialName="Existing"
        initialKind="official"
        allowOfficial
        busy={false}
        onClose={() => undefined}
        onSubmit={rename}
      />
    )
    expect(screen.queryByRole('button', { name: 'Threadbox project' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(rename).toHaveBeenCalledWith('Existing', 'official')
  })
})
