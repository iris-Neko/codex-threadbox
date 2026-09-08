// @vitest-environment node

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppServerClient } from '../../packages/core/src/app-server-client'
import { ThreadService } from '../../packages/core/src/thread-service'
import {
  CodexRuntime,
  parseCodexVersion,
  resolveCodexCandidates
} from '../../packages/core/src/codex-runtime'

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

async function writeFakeCli(directory: string, valid: boolean, version = '0.153.4'): Promise<string> {
  await mkdir(directory, { recursive: true })
  const windows = process.platform === 'win32'
  const command = join(directory, windows ? 'codex.cmd' : 'codex')
  const fixture = resolve('tests/fixtures/fake-codex-cli.cjs')
  const body = !valid
    ? windows ? '@echo off\r\nexit /b 1\r\n' : '#!/bin/sh\nexit 1\n'
    : windows
      ? '@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli ' + version +
        '\r\nexit /b 0\r\n)\r\n"' + process.execPath + '" "' + fixture + '" %*\r\n'
      : '#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex-cli ' + version +
        '; exit 0; fi\nexec "' + process.execPath + '" "' + fixture + '" "$@"\n'
  await writeFile(command, body, 'utf8')
  if (!windows) await chmod(command, 0o755)
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
  it('caches detected schemas across forced probes and invalidates them explicitly', async () => {
    const root = await temporaryDirectory('threadbox-capability-cache-')
    const command = await writeFakeCli(root, true)
    const log = join(root, 'requests.jsonl')
    process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
    const runtime = new CodexRuntime({ load: async () => ({ customCliPath: command }) }, {
      ...process.env, CODEX_HOME: root, THREADBOX_FAKE_LOG: log
    })
    expect((await runtime.probe()).status.capabilities.pinning).toBe(true)
    await runtime.probe(true)
    expect((await readFile(log, 'utf8')).trim().split(/\r?\n/)).toHaveLength(1)
    runtime.invalidate()
    await runtime.probe(true)
    expect((await readFile(log, 'utf8')).trim().split(/\r?\n/)).toHaveLength(2)
  })

  it('does not infer pins from an unsupported filter that silently returns all tasks', async () => {
    const root = await temporaryDirectory('threadbox-no-pinning-')
    const command = await writeFakeCli(root, true, '0.153.4')
    const log = join(root, 'requests.jsonl')
    process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
    const runtime = new CodexRuntime({ load: async () => ({ customCliPath: command }) }, {
      ...process.env, CODEX_HOME: root, THREADBOX_FAKE_LOG: log, THREADBOX_FAKE_PINNING: '0'
    })
    const client = new AppServerClient(runtime, { name: 'threadbox_test', title: 'Test', version: '0' })
    try {
      const service = new ThreadService(client)
      const listed = await service.listThreads()
      expect(listed.environment.capabilities.pinning).toBe(false)
      expect(listed.threads).toHaveLength(4)
      expect(listed.threads.every((thread) => !thread.pinned)).toBe(true)
      const id = listed.threads.find((thread) => !thread.parentThreadId)!.id
      expect((await service.previewDeleteThreads([id])).roots).toHaveLength(1)
      expect((await service.setPinned([id], false)).failed).toHaveLength(1)
      const requests = (await readFile(log, 'utf8')).trim().split(/\r?\n/)
        .map((line) => JSON.parse(line))
      expect(requests.some((r) => r.method === 'thread/metadata/update')).toBe(false)
      expect(requests.some((r) => r.method === 'thread/list' && 'isPinned' in r.params)).toBe(false)
    } finally { client.stop() }
  })

  it('blocks task operations when schemas cannot be verified, and retries after recovery', async () => {
    const root = await temporaryDirectory('threadbox-capability-failure-')
    const command = await writeFakeCli(root, true)
    const env = { ...process.env, CODEX_HOME: root, THREADBOX_FAKE_SCHEMA_FAIL: '1' }
    process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
    const runtime = new CodexRuntime({ load: async () => ({ customCliPath: command }) }, env)
    expect((await runtime.probe()).status).toMatchObject({
      state: 'error', message: expect.stringContaining('Could not verify Codex task safety')
    })
    const client = new AppServerClient(runtime, { name: 'threadbox_test', title: 'Test', version: '0' })
    try {
      await expect(client.request('thread/delete', { threadId: 'never-sent' }))
        .rejects.toThrow(/Could not verify/)
      env.THREADBOX_FAKE_SCHEMA_FAIL = '0'
      expect((await runtime.probe(true)).status.state).toBe('ready')
    } finally { client.stop() }
  })
  it('parses stable and prerelease Codex version output', () => {
    expect(parseCodexVersion('codex-cli 0.153.3')).toBe('0.153.3')
    expect(parseCodexVersion('codex-cli v0.153.3-alpha.1+build.2')).toBe(
      '0.153.3-alpha.1+build.2'
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
    expect(probe.status).toMatchObject({ state: 'ready', cliVersion: '0.153.4' })
  })

  it.each([
    ['0.153.3', 'ready'],
    ['0.153.4', 'ready'],
    ['0.153.2', 'outdated']
  ] as const)('classifies Codex CLI %s as %s', async (version, state) => {
    const root = await temporaryDirectory('threadbox-runtime-version-')
    const command = await writeFakeCli(root, true, version)

    process.env.CODEX_BINARY = command
    process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN = '1'
    const probe = await new CodexRuntime({
      load: async () => ({ locale: 'en', customCliPath: null })
    }).probe(true)

    expect(probe.status).toMatchObject({
      state,
      cliVersion: version,
      minimumVersion: '0.153.3'
    })
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
