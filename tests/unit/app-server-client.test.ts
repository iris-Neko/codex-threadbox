// @vitest-environment node

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppServerClient } from '../../packages/core/src/app-server-client'
import type { CodexRuntimeLike } from '../../packages/core/src/codex-runtime'

const fixture = resolve('tests/fixtures/fake-app-server.cjs')
const clients: AppServerClient[] = []
const descriptor = { name: 'threadbox_test', title: 'Threadbox Test', version: '0.3.0' }

function runtime(): CodexRuntimeLike {
  return {
    probe: async () => ({
      command: process.execPath,
      status: {
        state: 'ready',
        cliPath: process.execPath,
        cliVersion: '0.149.0',
        minimumVersion: '0.149.0',
        message: null,
        externalCodexProcesses: 0,
        capabilities: { pinning: false }
      }
    }),
    spawnAppServer: () => spawn(process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'pipe'] }),
    countExternalProcesses: async () => 0
  }
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.stop())
})

describe('AppServerClient', () => {
  it('initializes before requests and ignores interleaved notifications', async () => {
    const client = new AppServerClient(runtime(), descriptor)
    clients.push(client)

    await expect(client.request('test/echo', { hello: 'world' })).resolves.toEqual({
      initialized: true,
      value: { hello: 'world' }
    })
  })

  it('sends optional initialize capabilities only for opted-in hosts', async () => {
    const client = new AppServerClient(runtime(), {
      ...descriptor,
      initializeCapabilities: { experimentalApi: true, requestAttestation: false }
    })
    clients.push(client)

    await expect(client.request('test/initialize')).resolves.toMatchObject({
      capabilities: { experimentalApi: true, requestAttestation: false }
    })
  })

  it('times out unanswered requests', async () => {
    const client = new AppServerClient(runtime(), descriptor)
    clients.push(client)

    await expect(client.request('test/timeout', {}, 30)).rejects.toThrow('test/timeout timed out')
  })

  it('rejects a pending request when the server exits and can start again', async () => {
    const client = new AppServerClient(runtime(), descriptor)
    clients.push(client)

    await expect(client.request('test/crash')).rejects.toThrow('exited with code 2')
    await expect(client.request('test/echo', { recovered: true })).resolves.toMatchObject({
      initialized: true
    })
  })
})
