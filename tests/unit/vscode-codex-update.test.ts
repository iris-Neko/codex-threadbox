// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexCliUpdater } from '../../packages/vscode/src/codex-update'

const temporaryDirectories: string[] = []
const fakeCli = resolve(
  'tests/fixtures/bin',
  process.platform === 'win32' ? 'codex.cmd' : 'codex'
)

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'threadbox-codex-update-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 3 })
  ))
})

describe('VS Code Codex CLI update', () => {
  it('invokes only the installed Codex self-update command', async () => {
    const directory = await temporaryDirectory()
    const log = join(directory, 'update.log')
    const updater = new CodexCliUpdater()

    await expect(updater.update(fakeCli, {
      ...process.env,
      THREADBOX_FAKE_LOG: log
    })).resolves.toContain('fake Codex update completed')

    const entry = JSON.parse((await readFile(log, 'utf8')).trim()) as {
      event: string
      args: string[]
    }
    expect(entry).toEqual({ event: 'cli-update', args: ['update'] })
  })

  it('returns the updater error without retrying another installer', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.update(fakeCli, {
      ...process.env,
      THREADBOX_FAKE_UPDATE_FAIL: '1'
    })).rejects.toThrow('fake Codex update failed')
  })

  it('stops an update that exceeds the timeout', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.update(fakeCli, {
      ...process.env,
      THREADBOX_FAKE_UPDATE_DELAY_MS: '10000'
    }, 20)).rejects.toThrow('timed out after 20 ms')
  })
})
