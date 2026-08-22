import { _electron as electron } from 'playwright'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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

const executablePath = await packagedExecutable()
const fakeCli = resolve(
  'tests',
  'fixtures',
  'bin',
  process.platform === 'win32' ? 'codex.cmd' : 'codex'
)
const userData = await mkdtemp(join(tmpdir(), 'threadbox-packaged-'))
const application = await electron.launch({
  executablePath,
  args: ['--lang=en-US', `--user-data-dir=${userData}`],
  env: {
    ...process.env,
    CODEX_BINARY: fakeCli,
    THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
  }
})

try {
  const window = await application.firstWindow()
  await window.getByText('Desktop release workflow', { exact: true }).waitFor({ timeout: 20_000 })
  process.stdout.write(`Packaged application smoke test passed: ${executablePath}\n`)
} finally {
  await application.close()
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
