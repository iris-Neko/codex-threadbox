import { createInterface, type Interface } from 'node:readline'
import { spawnSync, type ChildProcess } from 'node:child_process'
import type { InitializeCapabilities } from '../../../src/shared/protocol/generated/InitializeCapabilities'
import type { CodexRuntimeLike, RuntimeProbe } from './codex-runtime'

export interface AppServerClientDescriptor {
  name: string
  title: string
  version: string
  initializeCapabilities?: InitializeCapabilities
}

interface RpcSuccess<T> {
  id: number
  result: T
}

interface RpcFailure {
  id: number
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type RpcResponse<T> = RpcSuccess<T> | RpcFailure

interface PendingRequest {
  resolve(value: unknown): void
  reject(reason: Error): void
  timer: NodeJS.Timeout
}

export interface RpcClientLike {
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  getProbe(force?: boolean): Promise<RuntimeProbe>
  restart(): Promise<void>
}

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
}

export class AppServerClient implements RpcClientLike {
  private child: ChildProcess | null = null
  private reader: Interface | null = null
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private starting: Promise<void> | null = null

  constructor(
    private readonly runtime: CodexRuntimeLike,
    private readonly descriptor: AppServerClientDescriptor
  ) {}

  getProbe(force = false): Promise<RuntimeProbe> {
    return this.runtime.probe(force)
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    await this.ensureStarted()
    return this.sendRequest<T>(method, params, timeoutMs)
  }

  async restart(): Promise<void> {
    this.stop()
    await this.ensureStarted()
  }

  stop(): void {
    const child = this.child
    this.reader?.close()
    this.reader = null
    this.child = null
    this.starting = null
    this.rejectPending(new Error('Codex app-server stopped.'))
    if (child) terminateChild(child)
  }

  private async ensureStarted(): Promise<void> {
    if (this.child?.stdin?.writable && !this.child.killed) return
    if (this.starting) return this.starting

    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<void> {
    const probe = await this.runtime.probe(true)
    if (probe.status.state !== 'ready') {
      throw new Error(probe.status.message ?? 'Codex CLI is not ready.')
    }

    const child = this.runtime.spawnAppServer(probe.command)
    if (!child.stdout || !child.stdin) throw new Error('Codex app-server did not expose stdio.')

    this.child = child
    this.reader = createInterface({ input: child.stdout })
    this.reader.on('line', (line) => this.handleLine(line))
    child.once('error', (error) => {
      if (this.child === child) this.handleExit(error)
    })
    child.once('exit', (code) => {
      if (this.child === child) {
        this.handleExit(new Error(`Codex app-server exited with code ${code ?? 'unknown'}.`))
      }
    })

    const initializeParams: Record<string, unknown> = {
      clientInfo: {
        name: this.descriptor.name,
        title: this.descriptor.title,
        version: this.descriptor.version
      }
    }
    if (this.descriptor.initializeCapabilities) {
      initializeParams.capabilities = this.descriptor.initializeCapabilities
    }
    await this.sendRequest('initialize', initializeParams)
    this.sendNotification('initialized', {})
  }

  private sendRequest<T>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })

      try {
        this.write({ method, id, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private sendNotification(method: string, params: unknown): void {
    this.write({ method, params })
  }

  private write(message: unknown): void {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not connected.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: RpcResponse<unknown>
    try {
      message = JSON.parse(line) as RpcResponse<unknown>
    } catch {
      return
    }

    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if ('error' in message) {
      pending.reject(new Error(message.error.message))
    } else {
      pending.resolve(message.result)
    }
  }

  private handleExit(error: Error): void {
    this.reader?.close()
    this.reader = null
    this.child = null
    this.rejectPending(error)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
