import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { chromium, expect } from '@playwright/test'

if (process.platform !== 'linux') throw new Error('Flatpak smoke testing requires Linux.')
const appId = 'io.github.iris_neko.codex_threadbox'
const home = await mkdtemp(join(homedir(), 'threadbox-flatpak-test-'))
const listener = createServer()
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
const port = listener.address().port
await new Promise((resolve) => listener.close(resolve))
const child = spawn('flatpak', [
  'run', `--env=CODEX_HOME=${home}`, `--env=CODEX_BINARY=${resolve('tests/fixtures/bin/codex')}`,
  '--env=THREADBOX_TEST_DISABLE_PROCESS_SCAN=1', appId,
  `--remote-debugging-port=${port}`, `--user-data-dir=${join(home, 'user-data')}`, '--lang=en-US'
], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-16000) })
child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-16000) })
let browser
try {
  const deadline = Date.now() + 45_000
  while (!browser && Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }) }
    catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
  if (!browser) throw new Error(`Flatpak did not start: ${output}`)
  const page = browser.contexts()[0].pages()[0]
  await expect(page.getByRole('article', { name: 'Desktop release workflow' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('button', { name: 'Product design', exact: true })).toBeVisible()
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/flatpak-main.png' })
  console.log('Installed Flatpak GUI and host Codex bridge smoke test passed with isolated fake data.')
} finally {
  await browser?.close()
  if (child.pid && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    process.kill(-child.pid, 'SIGTERM')
    await exited
  }
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
