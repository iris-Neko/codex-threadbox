import spawn from 'cross-spawn'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import semver from 'semver'
import type { EnvironmentStatus } from '../../../src/shared/contracts'

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

function capture(
  command: string,
  args: string[],
  timeoutMs = 8_000,
  env: NodeJS.ProcessEnv = process.env
): Promise<CapturedProcess> {
  return new Promise((resolve, reject) => {
    const child = launch(command, args, {
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error('The Codex CLI version check timed out.')))
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 32_768) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_768) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      finish(() => reject(error))
    })
    child.once('close', (code) => {
      finish(() => resolve({ stdout, stderr, code }))
    })
  })
}

export function parseCodexVersion(output: string): string | null {
  const match = output.match(
    /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/
  )
  return match?.[1] && semver.valid(match[1]) ? match[1] : null
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function windowsCommandNames(command: string, env: NodeJS.ProcessEnv): string[] {
  if (extname(command)) return [command]
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => /^\.(?:com|exe|bat|cmd)$/i.test(extension))
  return [...new Set(extensions.map((extension) => extension.toLowerCase()))].map(
    (extension) => `${command}${extension}`
  )
}

export function resolveCodexCandidates(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const trimmed = command.trim()
  if (isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) return [trimmed]

  const directories = (env.PATH ?? '')
    .split(delimiter)
    .map((directory) => directory.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)

  if (process.platform === 'win32' && trimmed.toLowerCase() === 'codex') {
    if (env.APPDATA) directories.push(join(env.APPDATA, 'npm'))
    if (env.USERPROFILE) directories.push(join(env.USERPROFILE, '.local', 'bin'))
  }

  const names = process.platform === 'win32' ? windowsCommandNames(trimmed, env) : [trimmed]
  const matches = uniquePaths(directories).flatMap((directory) =>
    names.map((name) => join(directory, name)).filter((candidate) => existsSync(candidate))
  )
  return uniquePaths(matches.length > 0 ? matches : [trimmed])
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

  constructor(
    private readonly settings: { load(): Promise<{ customCliPath: string | null }> },
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async probe(force = false): Promise<RuntimeProbe> {
    if (!force && this.cached && Date.now() - this.cached.at < PROBE_TTL_MS) {
      return this.cached.probe
    }

    const configured = await this.settings.load()
    const requestedCommand = configured.customCliPath ?? this.env.CODEX_BINARY?.trim() ?? 'codex'
    const candidates = resolveCodexCandidates(requestedCommand, this.env)
    const externalCodexProcesses = await this.countExternalProcesses()
    let lastCommand = candidates[0] ?? requestedCommand
    let lastError: unknown = null
    let launchedCandidate = false

    for (const command of candidates) {
      lastCommand = command
      try {
        const result = await capture(command, ['--version'], 8_000, this.env)
        launchedCandidate = true
        const version = parseCodexVersion(`${result.stdout}\n${result.stderr}`)
        if (result.code === 0 && version) {
          const probe = { command, status: readyStatus(command, version, externalCodexProcesses) }
          this.cached = { at: Date.now(), probe }
          return probe
        }
        lastError = new Error(`Codex CLI version probe exited with code ${result.code ?? 'unknown'}.`)
      } catch (error) {
        lastError = error
      }
    }

    const missing =
      !launchedCandidate && (lastError as NodeJS.ErrnoException | null)?.code === 'ENOENT'
    const probe: RuntimeProbe = {
      command: lastCommand,
      status: {
        state: missing ? 'missing' : 'error',
        cliPath: missing ? null : lastCommand,
        cliVersion: null,
        minimumVersion: MINIMUM_CODEX_VERSION,
        message: missing
          ? 'Codex CLI was not found. Install it or choose the executable in Settings.'
          : launchedCandidate
            ? 'Codex CLI candidates were found but none returned a valid version.'
            : lastError instanceof Error
              ? lastError.message
              : 'Unable to start Codex CLI.',
        externalCodexProcesses,
        capabilities: { pinning: false }
      }
    }
    this.cached = { at: Date.now(), probe }
    return probe
  }

  invalidate(): void {
    this.cached = null
  }

  spawnAppServer(command: string): ChildProcess {
    const child = launch(command, ['app-server', '--stdio'], {
      windowsHide: true,
      env: this.env,
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
        const result = await capture('tasklist.exe', ['/fo', 'csv', '/nh'], 8_000, this.env)
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

      const result = await capture('ps', ['-axo', 'pid=,comm=,args='], 8_000, this.env)
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
