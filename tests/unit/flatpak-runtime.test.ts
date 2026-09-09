// @vitest-environment node

import { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { flatpakHostLauncher } from '../../src/main/flatpak-runtime'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

describe('Flatpak host CLI bridge', () => {
  it('passes paths and arguments literally and ties host process lifetime to the bridge', () => {
    const options = { stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'] }
    flatpakHostLauncher('/home/user/My Codex')('/home/user/bin/codex;not-a-command', ['app-server', '--stdio'], options)
    expect(spawn).toHaveBeenCalledWith('/usr/bin/flatpak-spawn', [
      '--host', '--watch-bus', '--env=CODEX_HOME=/home/user/My Codex',
      'sh', '-lc', 'exec "$@"', 'threadbox-host', '/home/user/bin/codex;not-a-command', 'app-server', '--stdio'
    ], options)
  })
})
