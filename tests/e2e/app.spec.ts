import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('loads tasks from an isolated Codex app-server and protects deletion', async () => {
  const testInfo = test.info()
  const userData = await mkdtemp(resolve(tmpdir(), 'threadbox-e2e-'))
  const fakeCli = resolve(
    'tests/fixtures/bin',
    process.platform === 'win32' ? 'codex.cmd' : 'codex'
  )
  const electronApp = await electron.launch({
    args: ['.', '--lang=en-US', `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      CODEX_BINARY: fakeCli,
      CODEX_HOME: userData,
      THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
    }
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Threadbox for Codex' })).toBeVisible()
    await expect(window.getByText('Desktop release workflow', { exact: true })).toBeVisible()
    await expect(window.getByText('Project design review', { exact: true })).toBeVisible()
    await expect(window.getByText('Archived cleanup', { exact: true })).toBeVisible()
    await expect(window.getByText('Internal verification task', { exact: true })).toHaveCount(0)
    await expect(window.getByText('VS Code workspace', { exact: true })).toBeVisible()
    await expect(window.getByText('Desktop project', { exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: 'Collapse Independent tasks' })).toBeVisible()
    await window.screenshot({ path: testInfo.outputPath('threadbox-main.png'), fullPage: true })

    await window.getByRole('button', { name: 'Collapse threadbox' }).click()
    await expect(window.getByText('Desktop release workflow', { exact: true })).toHaveCount(0)
    await window.getByRole('button', { name: 'Expand threadbox' }).click()
    await expect(window.getByText('Desktop release workflow', { exact: true })).toBeVisible()

    const workspaceFilter = window.locator('.workspace-filter')
    await workspaceFilter.selectOption('project:project-design-system')
    await expect(window.getByText('Project design review', { exact: true })).toBeVisible()
    await expect(window.getByText('Desktop release workflow', { exact: true })).toHaveCount(0)
    await workspaceFilter.selectOption('all')

    await window.getByRole('button', { name: 'Flat' }).click()
    await expect(window.locator('.thread-group-row')).toHaveCount(0)
    await window.getByRole('button', { name: 'Groups' }).click()
    await expect(window.locator('.thread-group-row')).toHaveCount(3)

    const releaseRow = window.getByRole('row').filter({ hasText: 'Desktop release workflow' })
    await releaseRow
      .getByRole('button', { name: 'Show spawned tasks for Desktop release workflow' })
      .click()
    const childRow = window.getByRole('row').filter({ hasText: 'Internal verification task' })
    await expect(childRow).toBeVisible()
    const parentCheckbox = releaseRow.getByRole('checkbox', {
      name: 'Task: Desktop release workflow'
    })
    const childCheckbox = childRow.getByRole('checkbox', {
      name: 'Task: Internal verification task'
    })
    await parentCheckbox.check()
    await expect(childCheckbox).toBeChecked()
    await expect(childCheckbox).toBeDisabled()
    await expect(childRow.getByText('Included by parent')).toBeVisible()
    await expect(window.getByText('2 selected (1 directly, 1 included by parents)')).toBeVisible()
    await window.screenshot({ path: testInfo.outputPath('threadbox-parent-selected.png'), fullPage: true })
    await parentCheckbox.uncheck()
    await expect(parentCheckbox).not.toBeChecked()
    await expect(childCheckbox).not.toBeChecked()
    await expect(childCheckbox).toBeEnabled()
    await window.screenshot({ path: testInfo.outputPath('threadbox-expanded.png'), fullPage: true })
    await releaseRow
      .getByRole('button', { name: 'Hide spawned tasks for Desktop release workflow' })
      .click()
    await expect(childRow).toHaveCount(0)
    await releaseRow.locator('button').last().click()
    const confirm = window.locator('.modal__footer .button--danger')
    await expect(confirm).toBeDisabled()
    await window.locator('.confirmation-check input').check()
    await expect(confirm).toBeEnabled()
    await window.locator('.directory-cleanup__option input').check()
    await expect(confirm).toBeDisabled()
    await expect(confirm).toContainText('Delete tasks and trash directories')
    await window.locator('.confirmation-check input').check()
    await expect(confirm).toBeEnabled()

    await window.screenshot({ path: testInfo.outputPath('threadbox-delete-dialog.png'), fullPage: true })
    await window.locator('.modal__header .icon-button').click()
    await window.setViewportSize({ width: 960, height: 640 })
    await expect(window.locator('.content-area')).toBeVisible()
    await window.screenshot({ path: testInfo.outputPath('threadbox-minimum-size.png'), fullPage: true })
  } finally {
    await electronApp.close()
    await rm(userData, { recursive: true, force: true })
  }
})
