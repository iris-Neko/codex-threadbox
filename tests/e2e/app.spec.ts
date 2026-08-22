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
      THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
    }
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Threadbox for Codex' })).toBeVisible()
    await expect(window.getByText('Desktop release workflow', { exact: true })).toBeVisible()
    await expect(window.getByText('Archived cleanup', { exact: true })).toBeVisible()
    await expect(window.getByText('Internal verification task', { exact: true })).toHaveCount(0)
    await window.screenshot({ path: testInfo.outputPath('threadbox-main.png'), fullPage: true })

    const releaseRow = window.getByRole('row').filter({ hasText: 'Desktop release workflow' })
    await releaseRow.locator('button').last().click()
    const confirm = window.locator('.modal__footer .button--danger')
    await expect(confirm).toBeDisabled()
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
