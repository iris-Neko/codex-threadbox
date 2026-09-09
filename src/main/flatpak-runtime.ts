import { spawn } from 'node:child_process'
import type { RuntimeLauncher } from '@threadbox/core'

export function flatpakHostLauncher(codexHome: string): RuntimeLauncher {
  return (command, args, options = {}) => spawn('/usr/bin/flatpak-spawn', [
    '--host',
    '--watch-bus',
    `--env=CODEX_HOME=${codexHome}`,
    'sh', '-lc', 'exec "$@"', 'threadbox-host', command, ...args
  ], options)
}
