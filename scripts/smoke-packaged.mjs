import { _electron as electron } from 'playwright'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Keep looking for the platform-specific unpacked directory.
    }
  }
  throw new Error(`Packaged executable not found:\n${candidates.join('\n')}`)
}

async function packagedExecutable() {
  if (process.platform === 'win32') {
    return firstExisting([resolve('dist', 'win-unpacked', 'Threadbox for Codex.exe')])
  }

  const directories = await readdir(resolve('dist'), { withFileTypes: true })
  if (process.platform === 'darwin') {
    return firstExisting(
      directories
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('mac'))
        .map((entry) =>
          resolve(
            'dist',
            entry.name,
            'Threadbox for Codex.app',
            'Contents',
            'MacOS',
            'Threadbox for Codex'
          )
        )
    )
  }

  return firstExisting(
    directories
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux'))
      .map((entry) => resolve('dist', entry.name, 'threadbox-for-codex'))
  )
}

async function runPackagedSmoke(label, environment, verify) {
  const userData = await mkdtemp(join(tmpdir(), `threadbox-packaged-${label}-`))
  const application = await electron.launch({
    executablePath,
    args: ['--lang=en-US', `--user-data-dir=${userData}`],
    env: environment
  })

  try {
    const window = await application.firstWindow()
    await verify(window)
    process.stdout.write(`Packaged ${label} smoke test passed: ${executablePath}\n`)
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const executablePath = await packagedExecutable()
const fakeCli = resolve(
  'tests',
  'fixtures',
  'bin',
  process.platform === 'win32' ? 'codex.cmd' : 'codex'
)

await runPackagedSmoke(
  'fake-cli',
  {
    ...process.env,
    CODEX_BINARY: fakeCli,
    THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
  },
  (window) =>
    window.getByText('Desktop release workflow', { exact: true }).waitFor({ timeout: 20_000 })
)

const codexHome = await mkdtemp(join(tmpdir(), 'threadbox-packaged-codex-home-'))
try {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const realCliEnvironment = {
    ...process.env,
    CODEX_HOME: codexHome,
    THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
  }
  delete realCliEnvironment.CODEX_BINARY
  realCliEnvironment[pathKey] = [
    resolve('node_modules', '.bin'),
    realCliEnvironment[pathKey] ?? ''
  ].join(delimiter)

  await runPackagedSmoke('real-path-cli', realCliEnvironment, (window) =>
    window.getByText('Codex 0.149.0', { exact: true }).waitFor({ timeout: 20_000 })
  )
} finally {
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
