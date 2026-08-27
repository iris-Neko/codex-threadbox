import spawn from 'cross-spawn'
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { extname } from 'node:path'

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const OUTPUT_LIMIT = 32_768
const ERROR_OUTPUT_LIMIT = 4_000
const ANSI_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g'
)

function terminateChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.killed) return
  if (process.platform === 'win32') {
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

function spawnUpdate(command: string, env: NodeJS.ProcessEnv): ChildProcess {
  const options: SpawnOptions = {
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  }
  if (process.platform === 'win32' && extname(command).toLowerCase() === '.ps1') {
    return spawn('pwsh.exe', ['-NoProfile', '-File', command, 'update'], options)
  }
  return spawn(command, ['update'], options)
}

function cleanOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function updateError(code: number | null, stdout: string, stderr: string): Error {
  const detail = cleanOutput(`${stderr}\n${stdout}`).slice(-ERROR_OUTPUT_LIMIT)
  const suffix = detail ? ` ${detail}` : ''
  return new Error(`Codex CLI update exited with code ${code ?? 'unknown'}.${suffix}`)
}

export class CodexCliUpdater {
  private child: ChildProcess | null = null
  private cancelCurrent: ((reason: Error) => void) | null = null

  async update(
    command: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ): Promise<string> {
    if (this.child) throw new Error('A Codex CLI update is already running.')

    return new Promise<string>((resolve, reject) => {
      const child = spawnUpdate(command, env)
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
        terminateChild(child)
        finish(() => reject(reason))
      }
      timer = setTimeout(() => {
        this.stop(new Error(`Codex CLI update timed out after ${timeoutMs} ms.`))
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - stdout.length)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8').slice(0, OUTPUT_LIMIT - stderr.length)
      })
      child.once('error', (error) => finish(() => reject(error)))
      child.once('close', (code) => {
        if (code !== 0) finish(() => reject(updateError(code, stdout, stderr)))
        else finish(() => resolve(cleanOutput(`${stdout}\n${stderr}`)))
      })
    })
  }

  stop(reason = new Error('Codex CLI update stopped.')): void {
    this.cancelCurrent?.(reason)
  }
}
