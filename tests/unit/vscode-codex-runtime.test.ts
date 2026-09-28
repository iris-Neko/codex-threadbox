// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexRuntime, type RuntimeProbe } from '../../packages/core/src/codex-runtime'
import { VscodeCodexRuntime, VSCODE_MINIMUM_CODEX_VERSION } from '../../packages/vscode/src/codex-runtime'

afterEach(() => vi.restoreAllMocks())
const status = (version: string | null, state: RuntimeProbe['status']['state'] = 'ready'): RuntimeProbe => ({
  command: '/test-only-codex',
  status: { cliVersion: version, state, cliPath: '/test-only-codex', minimumVersion: '0.153.3',
    message: null, externalCodexProcesses: 0, capabilities: { pinning: false } }
})

describe('VS Code isolated runtime support floor', () => {
  it.each([['0.157.0', 'ready'], ['0.157.1', 'ready'], ['0.156.1', 'outdated'], ['0.153.4', 'outdated']] as const)(
    'classifies %s as %s without changing the shared runtime result', async (version, state) => {
      const base = status(version)
      vi.spyOn(CodexRuntime.prototype, 'probe').mockResolvedValue(base)
      const runtime = new VscodeCodexRuntime({ load: async () => ({ customCliPath: null }) })
      expect((await runtime.probe()).status).toMatchObject({ state, minimumVersion: VSCODE_MINIMUM_CODEX_VERSION })
      expect(base.status.minimumVersion).toBe('0.153.3')
      expect(base.status.state).toBe('ready')
    }
  )
  it('keeps missing CLI and current-version capability failures visible', async () => {
    vi.spyOn(CodexRuntime.prototype, 'probe').mockResolvedValueOnce(status(null, 'missing'))
      .mockResolvedValueOnce(status('0.157.1', 'error'))
    const runtime = new VscodeCodexRuntime({ load: async () => ({ customCliPath: null }) })
    expect((await runtime.probe()).status.state).toBe('missing')
    expect((await runtime.probe()).status.state).toBe('error')
  })
})
