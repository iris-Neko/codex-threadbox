import { execFile } from 'node:child_process'
import { readFile, realpath, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WriterOwner, WriterRecoveryBackend } from './writer-recovery'

export async function knownCodexExecutables(cli: string, extensionDirectory?: string): Promise<string[]> {
  const candidates: string[] = []
  const resolved = await realpath(cli)
  if (resolved.endsWith('/@openai/codex/bin/codex.js')) {
    const root = dirname(dirname(resolved))
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string }
    if (manifest.name !== '@openai/codex') throw new Error('Unrecognized Codex npm package.')
    for (const architecture of ['x64', 'arm64']) {
      for (const triple of ['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl',
        'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']) {
        candidates.push(join(root, 'node_modules', '@openai', 'codex-linux-' + architecture, 'vendor', triple, 'bin', 'codex'))
        candidates.push(join(dirname(root), 'codex-linux-' + architecture, 'vendor', triple, 'bin', 'codex'))
        candidates.push(join(root, 'vendor', triple, 'codex', 'codex'))
      }
    }
  } else {
    candidates.push(resolved)
  }
  if (extensionDirectory) {
    const bins = join(extensionDirectory, 'bin')
    for (const name of await readdir(bins).catch(() => [] as string[])) {
      if (name.startsWith('linux-')) candidates.push(join(bins, name, 'codex'))
    }
  }
  const paths: string[] = []
  for (const path of candidates) {
    try { paths.push(await realpath(path)) } catch { /* Optional installation layout. */ }
  }
  if (!paths.length) throw new Error('The native Codex executable could not be verified. No process was stopped.')
  return [...new Set(paths)]
}

export class LinuxWriterRecovery implements WriterRecoveryBackend {
  constructor(
    private readonly helper: string,
    private readonly codexHome: string,
    private readonly allowedExecutables: string[],
    private readonly guard: () => void
  ) {}

  private call(operation: string, threadId: string, approved?: WriterOwner): Promise<{
    owner?: WriterOwner | null; released?: boolean
  }> {
    this.guard()
    if (process.platform !== 'linux') throw new Error('Automatic writer recovery is available only on Linux.')
    return new Promise((resolve, reject) => {
      const child = execFile('python3', ['-I', '-B', this.helper], {
        timeout: 8_000, maxBuffer: 262_144, windowsHide: true
      }, (error, stdout) => {
        try {
          const response = JSON.parse(stdout) as { error?: string; owner?: WriterOwner | null; released?: boolean }
          if (error || response.error) reject(new Error(response.error ?? 'The Linux recovery helper failed.'))
          else resolve(response)
        } catch {
          reject(new Error('Writer recovery requires Python 3.9+ and Linux pidfd support. ' + (error?.message ?? 'Invalid helper response.')))
        }
      })
      child.stdin?.on('error', () => { /* execFile reports helper startup and exit failures. */ })
      child.stdin?.end(JSON.stringify({
        operation, threadId, approved, codexHome: this.codexHome, allowedExecutables: this.allowedExecutables
      }))
    })
  }

  async inspect(threadId: string): Promise<WriterOwner | null> {
    return (await this.call('inspect', threadId)).owner ?? null
  }
  async signal(threadId: string, owner: WriterOwner, force: boolean): Promise<void> {
    await this.call(force ? 'force' : 'terminate', threadId, owner)
  }
  async released(threadId: string, owner: WriterOwner): Promise<boolean> {
    return (await this.call('check', threadId, owner)).released === true
  }
}
