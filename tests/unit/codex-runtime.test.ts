// @vitest-environment node

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CodexRuntime,
  parseCodexVersion,
  resolveCodexCandidates
} from '../../src/main/codex-runtime'

const temporaryDirectories: string[] = []
const originalEnvironment = {
  APPDATA: process.env.APPDATA,
  CODEX_BINARY: process.env.CODEX_BINARY,
  PATH: process.env.PATH,
  PATHEXT: process.env.PATHEXT,
  THREADBOX_TEST_DISABLE_PROCESS_SCAN: process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN,
  USERPROFILE: process.env.USERPROFILE
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

async function writeFakeCli(directory: string, valid: boolean): Promise<string> {
  await mkdir(directory, { recursive: true })
  if (process.platform === 'win32') {
    const command = join(directory, 'codex.cmd')
    await writeFile(
      command,
      valid
        ? '@echo off\r\necho codex-cli 0.149.0\r\n'
        : '@echo off\r\necho broken 1>&2\r\nexit /b 1\r\n',
      'utf8'
    )
    return command
  }

  const command = join(directory, 'codex')
  await writeFile(
    command,
    valid ? '#!/bin/sh\nprintf "codex-cli 0.149.0\\n"\n' : '#!/bin/sh\nexit 1\n',
    'utf8'
  )
  await chmod(command, 0o755)
  return command
}

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3 })
    )
  )
})

describe('CodexRuntime', () => {
  it('parses stable and prerelease Codex version output', () => {
    expect(parseCodexVersion('codex-cli 0.149.0')).toBe('0.149.0')
    expect(parseCodexVersion('codex-cli v0.150.0-alpha.1+build.2')).toBe(
      '0.150.0-alpha.1+build.2'
    )
    expect(parseCodexVersion('not a version')).toBeNull()
  })

  it('continues past a broken PATH candidate and uses the next valid CLI', async () => {
    const root = await temporaryDirectory('threadbox-runtime-')
    const brokenDirectory = join(root, 'broken')
    const validDirectory = join(root, 'valid')
    await writeFakeCli(brokenDirectory, false)
    const validCommand = await writeFakeCli(validDirectory, true)

    process.env.PATH = `${brokenDirectory}${delimiter}${validDirectory}`
    process.env.APPDATA = join(root, 'unused-appdata')
    process.env.USERPROFILE = join(root, 'unused-profile')
    delete process.env.CODEX_BINARY
    process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'

    const runtime = new CodexRuntime({
      load: async () => ({ locale: 'en', customCliPath: null })
    })
    const probe = await runtime.probe(true)

    expect(probe.command).toBe(validCommand)
    expect(probe.status).toMatchObject({ state: 'ready', cliVersion: '0.149.0' })
  })

  it.runIf(process.platform === 'win32')(
    'finds the standard Windows npm shim even when it is absent from PATH',
    async () => {
      const root = await temporaryDirectory('threadbox-npm-shim-')
      const appData = join(root, 'AppData', 'Roaming')
      const npmDirectory = join(appData, 'npm')
      const command = await writeFakeCli(npmDirectory, true)
      const candidates = resolveCodexCandidates('codex', {
        APPDATA: appData,
        PATH: '',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        USERPROFILE: join(root, 'profile')
      })

      expect(candidates).toContain(command)
    }
  )
})
