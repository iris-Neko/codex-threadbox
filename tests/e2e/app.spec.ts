import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('desktop manages main tasks and submits cascade deletion safely', async () => {
  const userData = await mkdtemp(resolve(tmpdir(), 'threadbox-e2e-'))
  const log = resolve(userData, 'rpc.jsonl')
  const legacyPath = resolve(userData, '.codex-global-state.json')
  const legacyMetadata = JSON.stringify({
    'local-projects': { legacy: { id: 'legacy', name: 'Old desktop title' } },
    'thread-project-assignments': { '019f0000-0000-7000-8000-000000000001': { projectKind: 'local', projectId: 'legacy' } },
    'app-server-project-id-by-legacy-project-id-by-host': { [`local:${userData}`]: { legacy: 'project-legacy' } }
  })
  await writeFile(legacyPath, legacyMetadata)
  const electronApp = await electron.launch({
    args: ['.', '--lang=en-US', `--user-data-dir=${userData}`],
    env: { ...process.env, CODEX_BINARY: resolve('tests/fixtures/bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'), CODEX_HOME: userData, THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1', THREADBOX_FAKE_LOG: log }
  })
  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Threadbox', exact: true })).toBeVisible()
    await expect(window.getByRole('article')).toHaveCount(3)
    await expect(window.getByText('Internal verification task', { exact: true })).toHaveCount(0)
    await expect(window.getByText('v1.0.0', { exact: true })).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('desktop-main.png'), fullPage: true })
    const projects = window.getByRole('region', { name: 'Projects', exact: true })
    await projects.getByRole('button', { name: 'Desktop planning', exact: true }).click()
    await expect(window.getByRole('article', { name: 'Desktop release workflow', exact: true })).toBeVisible()
    await expect(window.getByRole('article')).toHaveCount(1)
    await projects.getByRole('button', { name: 'Product design', exact: true }).click()
    await expect(projects.getByRole('button', { name: 'Project design review', exact: true })).toBeVisible()
    await projects.getByRole('button', { name: 'Project design review', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Project design review', exact: true })).toBeVisible()
    await expect(window.getByRole('region', { name: 'Directories', exact: true }).getByRole('button', { name: /design-system/ })).toBeVisible()
    await expect(window.getByRole('article')).toHaveCount(1)
    await expect(window.getByRole('article', { name: 'Project design review' })).toBeVisible()
    await window.getByRole('navigation').getByRole('button', { name: /All tasks/ }).click()
    const search = window.getByRole('textbox').first()
    await search.fill('Internal verification')
    await expect(window.getByRole('article')).toHaveCount(0)
    await search.fill('')
    const release = window.getByRole('article', { name: 'Desktop release workflow' })
    await release.getByRole('checkbox').check()
    await expect(window.getByText('1 selected', { exact: true })).toBeVisible()
    await window.screenshot({ path: test.info().outputPath('desktop-selected.png'), fullPage: true })
    await window.getByRole('button', { name: 'Clear selection', exact: true }).click()
    await release.getByRole('button', { name: 'Delete tasks...', exact: true }).click()
    const dialog = window.getByRole('dialog')
    const confirm = dialog.locator('.modal__footer .button--danger')
    await expect(confirm).toBeDisabled()
    await expect(dialog.locator('.impact-list')).toContainText('1')
    await dialog.locator('.confirmation-check input').check()
    await expect(confirm).toBeEnabled()
    await dialog.locator('summary').click()
    await dialog.locator('.directory-cleanup__option input').check()
    await expect(confirm).toBeDisabled()
    await dialog.locator('.directory-cleanup__option input').uncheck()
    await dialog.locator('.confirmation-check input').check()
    await window.screenshot({ path: test.info().outputPath('desktop-delete.png'), fullPage: true })
    await confirm.click()
    await expect(dialog).toHaveCount(0)
    const requests = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(requests.filter((item) => item.method === 'thread/delete').map((item) => item.params.threadId)).toEqual(['019f0000-0000-7000-8000-000000000001'])
    expect(requests.some((item) => item.method === 'project/list')).toBe(true)
    expect(await readFile(legacyPath, 'utf8')).toBe(legacyMetadata)
    await window.locator('.desktop-feedback').getByRole('button', { name: 'Close' }).click()
    await window.setViewportSize({ width: 960, height: 640 })
    await expect(release).toBeVisible()
    expect(await window.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
    await window.screenshot({ path: test.info().outputPath('desktop-minimum.png'), fullPage: true })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.screenshot({ path: test.info().outputPath('desktop-dark.png'), fullPage: true })
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await window.getByRole('dialog').getByRole('combobox').selectOption('zh-CN')
    await window.getByRole('button', { name: 'Save settings', exact: true }).click()
    await expect(window.getByRole('heading', { name: '全部任务' })).toBeVisible()
    await expect(window.getByRole('button', { name: '刷新', exact: true })).toBeEnabled()
    await window.screenshot({ path: test.info().outputPath('desktop-chinese.png'), fullPage: true })
  } finally {
    await electronApp.close()
    await rm(userData, { recursive: true, force: true })
  }
})
