// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CodexCliPermissionError,
  CodexCliUpdater,
  NPM_UNINSTALL_COMMAND,
  SUDO_NPM_UNINSTALL_COMMAND,
  SUDO_NPM_UPDATE_COMMAND,
  isNpmPermissionErrorOutput,
  standaloneCodexPath,
  standaloneInstallerCommand
} from '../../packages/vscode/src/codex-update'

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

  it('classifies npm permission failures for the recovery prompt', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.update(fakeCli, {
      ...process.env,
      THREADBOX_FAKE_UPDATE_PERMISSION: '1'
    })).rejects.toBeInstanceOf(CodexCliPermissionError)
    expect(isNpmPermissionErrorOutput(
      'npm error code EPERM\nnpm error path C:\\Program Files\\node_modules\\@openai\\codex'
    )).toBe(true)
    expect(isNpmPermissionErrorOutput('network request failed')).toBe(false)
  })

  it('uses only the official standalone installer commands and user paths', () => {
    expect(SUDO_NPM_UPDATE_COMMAND).toBe('sudo npm install -g @openai/codex')
    expect(SUDO_NPM_UNINSTALL_COMMAND).toBe('sudo npm uninstall -g @openai/codex')
    expect(NPM_UNINSTALL_COMMAND).toBe('npm uninstall -g @openai/codex')
    expect(standaloneInstallerCommand('linux')).toEqual({
      command: 'sh',
      args: ['-c', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh']
    })
    expect(standaloneInstallerCommand('win32')).toEqual({
      command: 'powershell.exe',
      args: [
        '-NoProfile', '-ExecutionPolicy', 'ByPass', '-Command',
        'irm https://chatgpt.com/codex/install.ps1 | iex'
      ]
    })
    expect(standaloneCodexPath('linux', {}, '/home/iris')).toBe('/home/iris/.local/bin/codex')
    expect(standaloneCodexPath('win32', {
      LOCALAPPDATA: 'C:\\Users\\Iris\\AppData\\Local'
    }, 'C:\\Users\\Iris')).toBe(
      'C:\\Users\\Iris\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'
    )
  })

  it('runs an installer and verifies its exact user-level executable', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.installStandalone(
      { ...process.env, THREADBOX_FAKE_VERSION: '0.150.1' },
      5_000,
      { command: fakeCli, args: ['--version'] },
      fakeCli
    )).resolves.toMatchObject({ path: fakeCli, version: '0.150.1' })
  })

  it('rejects a standalone executable that remains below the minimum version', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.installStandalone(
      { ...process.env, THREADBOX_FAKE_VERSION: '0.149.1' },
      5_000,
      { command: fakeCli, args: ['--version'] },
      fakeCli
    )).rejects.toThrow('did not report version 0.150.0 or newer')
  })

  it('surfaces standalone installer failures without probing or changing a CLI', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.installStandalone(
      { ...process.env, THREADBOX_FAKE_UPDATE_FAIL: '1' },
      5_000,
      { command: fakeCli, args: ['update'] },
      fakeCli
    )).rejects.toThrow('Codex CLI standalone installer exited with code 9')
  })

  it('stops an update that exceeds the timeout', async () => {
    const updater = new CodexCliUpdater()

    await expect(updater.update(fakeCli, {
      ...process.env,
      THREADBOX_FAKE_UPDATE_DELAY_MS: '10000'
    }, 20)).rejects.toThrow('timed out after 20 ms')
  })
})
