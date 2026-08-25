import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDialog } from '../../packages/ui/src/components/ProjectDialog'
import '../../packages/ui/src/i18n'

afterEach(cleanup)

describe('ProjectDialog', () => {
  it('creates a single local project type', () => {
    const submit = vi.fn()
    render(
      <ProjectDialog
        busy={false}
        onClose={() => undefined}
        onSubmit={submit}
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), {
      target: { value: 'Shared project' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(submit).toHaveBeenCalledWith('Shared project')
    expect(screen.queryByText('Codex project')).not.toBeInTheDocument()
  })

  it('renames an existing project without a type selector', () => {
    const rename = vi.fn()
    render(
      <ProjectDialog
        initialName="Existing"
        busy={false}
        onClose={() => undefined}
        onSubmit={rename}
      />
    )
    expect(screen.queryByText('Codex project')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(rename).toHaveBeenCalledWith('Existing')
  })
})
