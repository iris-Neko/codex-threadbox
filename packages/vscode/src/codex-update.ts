import spawn from 'cross-spawn'
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, extname, posix, win32 } from 'node:path'
import semver from 'semver'
import {
  MINIMUM_CODEX_VERSION,
  parseCodexVersion
} from '../../core/src/codex-runtime'

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const VERIFY_TIMEOUT_MS = 8_000
const OUTPUT_LIMIT = 32_768
const ERROR_OUTPUT_LIMIT = 4_000
export const SUDO_NPM_UPDATE_COMMAND = 'sudo npm install -g @openai/codex'
export const SUDO_NPM_UNINSTALL_COMMAND = 'sudo npm uninstall -g @openai/codex'
export const NPM_UNINSTALL_COMMAND = 'npm uninstall -g @openai/codex'
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g'
)

export interface InstallerCommand {
  command: string
  args: string[]
}

export interface StandaloneInstallResult {
  path: string
  version: string
  output: string
}

export class CodexCliPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexCliPermissionError'
  }
}

function terminateChild(child: ChildProcess, platform: NodeJS.Platform): void {
  if (!child.pid || child.exitCode !== null || child.killed) return
  if (platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    return
  }
  child.kill('SIGTERM')
  const force = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 2_000)
  force.unref()
}

function cleanOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function errorDetail(stdout: string, stderr: string): string {
  return cleanOutput(`${stderr}\n${stdout}`).slice(-ERROR_OUTPUT_LIMIT)
}

export function isNpmPermissionErrorOutput(value: string): boolean {
  return /npm error code (?:EACCES|EPERM)\b/i.test(value) ||
    /(?:EACCES|EPERM):[^\r\n]*(?:node_modules|@openai[\\/]codex)/i.test(value)
}

function updateError(code: number | null, stdout: string, stderr: string): Error {
  const detail = errorDetail(stdout, stderr)
  const suffix = detail ? ` ${detail}` : ''
  const message = `Codex CLI update exited with code ${code ?? 'unknown'}.${suffix}`
  return isNpmPermissionErrorOutput(`${stderr}\n${stdout}`)
    ? new CodexCliPermissionError(message)
    : new Error(message)
}

function commandError(
  operation: string,
  code: number | null,
  stdout: string,
  stderr: string
): Error {
  const detail = errorDetail(stdout, stderr)
  const suffix = detail ? ` ${detail}` : ''
  return new Error(`${operation} exited with code ${code ?? 'unknown'}.${suffix}`)
}

export function standaloneInstallerCommand(platform: NodeJS.Platform): InstallerCommand {
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'ByPass',
        '-Command',
        'irm https://chatgpt.com/codex/install.ps1 | iex'
      ]
    }
  }
  return {
    command: 'sh',
    args: ['-c', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh']
  }
}

export function standaloneCodexPath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home = homedir()
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || win32.join(home, 'AppData', 'Local')
    return win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
  }
  return posix.join(home, '.local', 'bin', 'codex')
}

interface CapturedProcess {
  stdout: string
  stderr: string
}

export class CodexCliUpdater {
  private child: ChildProcess | null = null
  private cancelCurrent: ((reason: Error) => void) | null = null

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async update(
    command: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<string> {
    const options: SpawnOptions = {
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
    const target = this.platform === 'win32' && extname(command).toLowerCase() === '.ps1'
      ? { command: 'pwsh.exe', args: ['-NoProfile', '-File', command, 'update'] }
      : { command, args: ['update'] }
    const result = await this.run(
      target.command,
      target.args,
      options,
      timeoutMs,
      (code, stdout, stderr) => updateError(code, stdout, stderr),
      `Codex CLI update timed out after ${timeoutMs} ms.`
    )
    return cleanOutput(`${result.stdout}\n${result.stderr}`)
  }

  async installStandalone(
    env: NodeJS.ProcessEnv,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    installer = standaloneInstallerCommand(this.platform),
    installedPath = standaloneCodexPath(this.platform, env)
  ): Promise<StandaloneInstallResult> {
    const installEnvironment = {
      ...env,
      CODEX_INSTALL_DIR: dirname(installedPath),
      CODEX_NON_INTERACTIVE: '1'
    }
    const options: SpawnOptions = {
      windowsHide: true,
      env: installEnvironment,
      stdio: ['ignore', 'pipe', 'pipe']
    }
    const installed = await this.run(
      installer.command,
      installer.args,
      options,
      timeoutMs,
      (code, stdout, stderr) => commandError(
        'Codex CLI standalone installer', code, stdout, stderr
      ),
      `Codex CLI standalone installation timed out after ${timeoutMs} ms.`
    )
    const verified = await this.run(
      installedPath,
      ['--version'],
      { windowsHide: true, env: installEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
      VERIFY_TIMEOUT_MS,
      (code, stdout, stderr) => commandError(
        'Installed Codex CLI verification', code, stdout, stderr
      ),
      'Installed Codex CLI version check timed out.'
    )
    const version = parseCodexVersion(`${verified.stdout}\n${verified.stderr}`)
    if (!version || !semver.gte(version, MINIMUM_CODEX_VERSION)) {
      throw new Error(
        `The user-level Codex CLI at ${installedPath} did not report version ${MINIMUM_CODEX_VERSION} or newer.`
      )
    }
    return {
      path: installedPath,
      version,
      output: cleanOutput(`${installed.stdout}\n${installed.stderr}`)
    }
  }

  private run(
    command: string,
    args: string[],
    options: SpawnOptions,
    timeoutMs: number,
    createError: (code: number | null, stdout: string, stderr: string) => Error,
    timeoutMessage: string
  ): Promise<CapturedProcess> {
    if (this.child) throw new Error('A Codex CLI install or update is already running.')

    return new Promise<CapturedProcess>((resolve, reject) => {
      const child = spawn(command, args, options)
      this.child = child
      let stdout = ''
      let stderr = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (this.child === child) {
          this.child = null
          this.cancelCurrent = null
        }
        callback()
      }
      this.cancelCurrent = (reason) => {
        terminateChild(child, this.platform)
        finish(() => reject(reason))
      }
      timer = setTimeout(() => this.stop(new Error(timeoutMessage)), timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < OUTPUT_LIMIT) {
          stdout += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - stdout.length)
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < OUTPUT_LIMIT) {
          stderr += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - stderr.length)
        }
      })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('close', (code) => {
        if (code !== 0) finish(() => reject(createError(code, stdout, stderr)))
        else finish(() => resolve({ stdout, stderr }))
      })
    })
  }

  stop(reason = new Error('Codex CLI install or update stopped.')): void {
    this.cancelCurrent?.(reason)
  }
}
