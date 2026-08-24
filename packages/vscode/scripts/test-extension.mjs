import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron'

const packageRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
const workspace = await mkdtemp(join(tmpdir(), 'threadbox-vscode-workspace-'))
const installation = await mkdtemp(join(tmpdir(), 'threadbox-vscode-installation-'))
const extensionsDirectory = join(installation, 'extensions')
const userData = join(installation, 'user-data')
const developmentUserData = join(installation, 'development-user-data')
const fakeCli = resolve(
  packageRoot,
  '../../tests/fixtures/bin',
  process.platform === 'win32' ? 'codex.cmd' : 'codex'
)
const vsix = resolve(packageRoot, `../../dist/threadbox-for-codex-${manifest.version}.vsix`)

try {
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable')
  const vscodeCliPath = resolve(
    dirname(vscodeExecutablePath),
    'bin',
    process.platform === 'win32' ? 'code.cmd' : 'code'
  )
  process.env.THREADBOX_TEST_FAKE_CLI = fakeCli
  process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: packageRoot,
    extensionTestsPath: resolve(packageRoot, 'test-dist/index.cjs'),
    launchArgs: [workspace, '--user-data-dir', developmentUserData,
      '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes']
  })

  const installed = spawnSync(vscodeCliPath, [
    '--install-extension', vsix,
    '--extensions-dir', extensionsDirectory,
    '--user-data-dir', userData
  ], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000 })
  if (installed.status !== 0) {
    throw new Error(`VSIX installation failed:\n${installed.stdout}\n${installed.stderr}`)
  }
  const listed = spawnSync(vscodeCliPath, [
    '--list-extensions',
    '--extensions-dir', extensionsDirectory,
    '--user-data-dir', userData
  ], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000 })
  if (listed.status !== 0 || !listed.stdout.toLowerCase().includes('irisneko.threadbox-for-codex')) {
    throw new Error(`Installed VSIX was not listed:\n${listed.stdout}\n${listed.stderr}`)
  }

  const launched = spawn(vscodeExecutablePath, [
    workspace,
    '--extensions-dir', extensionsDirectory,
    '--user-data-dir', userData,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes'
  ], { stdio: 'ignore' })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000))
  if (process.platform === 'win32' && launched.pid) {
    spawnSync('taskkill.exe', ['/pid', String(launched.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } else {
    launched.kill('SIGTERM')
  }
  process.stdout.write('VS Code extension and installed VSIX smoke tests passed.\n')
} finally {
  delete process.env.THREADBOX_TEST_FAKE_CLI
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(installation, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
