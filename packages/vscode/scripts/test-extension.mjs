import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
const fakeLog = join(workspace, 'fake-app-server.log')
const fakeCreatedFile = join(workspace, 'fake-created-threads.json')
const isolatedEnvironment = {
  CODEX_HOME: join(workspace, 'isolated-codex'), CODEX_BINARY: fakeCli,
  THREADBOX_FAKE_VERSION: '0.157.1', THREADBOX_FAKE_UPDATED_VERSION: '0.157.1',
  CLAUDE_CONFIG_DIR: join(workspace, 'isolated-claude'),
  THREADBOX_TEST_CLAUDE_LOG: join(workspace, 'fake-claude-open.log')
}
const previousEnvironment = Object.fromEntries(Object.keys(isolatedEnvironment).map((key) => [key, process.env[key]]))
Object.assign(process.env, isolatedEnvironment)

try {
  await cp(resolve(packageRoot, '../../tests/fixtures/claude-vscode-extension'),
    join(extensionsDirectory, 'anthropic.claude-code-2.1.283'), { recursive: true })
  const assets = await readdir(resolve(packageRoot, 'dist'))
  if (assets.some((name) => name.startsWith('webview'))) throw new Error('Manager Webview assets remain in the extension.')
  const bundle = await readFile(resolve(packageRoot, 'dist/extension.cjs'), 'utf8')
  if (bundle.includes('createWebviewPanel') || bundle.includes('acquireVsCodeApi')) {
    throw new Error('The sidebar extension still contains a Manager entry point.')
  }
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable')
  const vscodeCliPath = resolve(
    dirname(vscodeExecutablePath),
    'bin',
    process.platform === 'win32' ? 'code.cmd' : 'code'
  )
  process.env.THREADBOX_TEST_FAKE_CLI = fakeCli
  process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
  process.env.THREADBOX_FAKE_WORKSPACE = workspace
  process.env.THREADBOX_FAKE_LOG = fakeLog
  process.env.THREADBOX_FAKE_CREATED_FILE = fakeCreatedFile
  process.env.THREADBOX_FAKE_PINNING = '0'
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: packageRoot,
    extensionTestsPath: resolve(packageRoot, 'test-dist/index.cjs'),
    launchArgs: [workspace, '--user-data-dir', developmentUserData, '--extensions-dir', extensionsDirectory,
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
  if (listed.status !== 0 || !listed.stdout.toLowerCase().includes('irisneko.codex-threadbox-vscode')) {
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
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  delete process.env.THREADBOX_TEST_FAKE_CLI
  delete process.env.THREADBOX_FAKE_WORKSPACE
  delete process.env.THREADBOX_FAKE_LOG
  delete process.env.THREADBOX_FAKE_CREATED_FILE
  delete process.env.THREADBOX_FAKE_PINNING
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(installation, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
