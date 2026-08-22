import spawn from 'cross-spawn'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { extname } from 'node:path'
import semver from 'semver'
import type { EnvironmentStatus } from '../shared/contracts'
import type { SettingsStore } from './settings-store'

export const MINIMUM_CODEX_VERSION = '0.149.0'
const PINNING_VERSION = '0.150.0'
const PROBE_TTL_MS = 10_000

export interface RuntimeProbe {
  status: EnvironmentStatus
  command: string
}

export interface CodexRuntimeLike {
  probe(force?: boolean): Promise<RuntimeProbe>
  spawnAppServer(command: string): ChildProcess
  countExternalProcesses(excludedPid?: number): Promise<number>
}

interface CapturedProcess {
  stdout: string
  stderr: string
  code: number | null
}

function launch(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  if (process.platform === 'win32' && extname(command).toLowerCase() === '.ps1') {
    return spawn('pwsh.exe', ['-NoProfile', '-File', command, ...args], options)
  }
  return spawn(command, args, options)
}

function capture(command: string, args: string[], timeoutMs = 8_000): Promise<CapturedProcess> {
  return new Promise((resolve, reject) => {
    const child = launch(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The Codex CLI version check timed out.'))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32_768) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_768) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

function parseVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)
  return match?.[1] && semver.valid(match[1]) ? match[1] : null
}

function readyStatus(command: string, version: string, externalCodexProcesses: number): EnvironmentStatus {
  return {
    state: semver.gte(version, MINIMUM_CODEX_VERSION) ? 'ready' : 'outdated',
    cliPath: command,
    cliVersion: version,
    minimumVersion: MINIMUM_CODEX_VERSION,
    message: semver.gte(version, MINIMUM_CODEX_VERSION)
      ? null
      : `Codex CLI ${MINIMUM_CODEX_VERSION} or newer is required.`,
    externalCodexProcesses,
    capabilities: {
      pinning: semver.gte(version, PINNING_VERSION)
    }
  }
}

export class CodexRuntime implements CodexRuntimeLike {
  private cached: { at: number; probe: RuntimeProbe } | null = null
  private readonly ownedProcessIds = new Set<number>()

  constructor(private readonly settings: SettingsStore) {}

  async probe(force = false): Promise<RuntimeProbe> {
    if (!force && this.cached && Date.now() - this.cached.at < PROBE_TTL_MS) {
      return this.cached.probe
    }

    const configured = await this.settings.load()
    const command = configured.customCliPath ?? process.env.CODEX_BINARY?.trim() ?? 'codex'
    const externalCodexProcesses = await this.countExternalProcesses()

    try {
      const result = await capture(command, ['--version'])
      const version = parseVersion(`${result.stdout}\n${result.stderr}`)
      if (result.code !== 0 || !version) {
        const probe: RuntimeProbe = {
          command,
          status: {
            state: 'error',
            cliPath: command,
            cliVersion: version,
            minimumVersion: MINIMUM_CODEX_VERSION,
            message: 'Codex CLI was found but did not return a valid version.',
            externalCodexProcesses,
            capabilities: { pinning: false }
          }
        }
        this.cached = { at: Date.now(), probe }
        return probe
      }

      const probe = { command, status: readyStatus(command, version, externalCodexProcesses) }
      this.cached = { at: Date.now(), probe }
      return probe
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      const probe: RuntimeProbe = {
        command,
        status: {
          state: missing ? 'missing' : 'error',
          cliPath: configured.customCliPath ?? process.env.CODEX_BINARY?.trim() ?? null,
          cliVersion: null,
          minimumVersion: MINIMUM_CODEX_VERSION,
          message: missing
            ? 'Codex CLI was not found. Install it or choose the executable in Settings.'
            : error instanceof Error
              ? error.message
              : 'Unable to start Codex CLI.',
          externalCodexProcesses,
          capabilities: { pinning: false }
        }
      }
      this.cached = { at: Date.now(), probe }
      return probe
    }
  }

  invalidate(): void {
    this.cached = null
  }

  spawnAppServer(command: string): ChildProcess {
    const child = launch(command, ['app-server', '--stdio'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    })
    if (child.pid) {
      this.ownedProcessIds.add(child.pid)
      child.once('exit', () => this.ownedProcessIds.delete(child.pid!))
    }
    return child
  }

  async countExternalProcesses(excludedPid?: number): Promise<number> {
    if (process.env.THREADBOX_TEST_DISABLE_PROCESS_SCAN === '1') return 0
    try {
      if (process.platform === 'win32') {
        const result = await capture('tasklist.exe', ['/fo', 'csv', '/nh'])
        return result.stdout
          .split(/\r?\n/)
          .map((line) => line.match(/^"([^"]+)","(\d+)"/))
          .filter((match): match is RegExpMatchArray => Boolean(match))
          .filter((match) => /^codex\.exe$/i.test(match[1] ?? ''))
          .filter((match) => {
            const pid = Number(match[2])
            return pid !== excludedPid && !this.ownedProcessIds.has(pid)
          }).length
      }

      const result = await capture('ps', ['-axo', 'pid=,comm=,args='])
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .filter((match) => {
          const pid = Number(match[1])
          return pid !== excludedPid && !this.ownedProcessIds.has(pid)
        })
        .filter((match) => {
          const executable = match[2] ?? ''
          const args = match[3] ?? ''
          return /(^|\/)codex$/i.test(executable) || /\/Codex\.app\//i.test(args)
        }).length
    } catch {
      return 0
    }
  }
}
