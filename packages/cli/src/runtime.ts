import { resolve } from 'node:path'
import {
  AppServerClient,
  CodexRuntime,
  ThreadService
} from '../../core/src/index'

export interface CliRuntimeOptions {
  codexBinary?: string
  codexHome?: string
}

export function createCliRuntime(options: CliRuntimeOptions): {
  runtime: CodexRuntime
  client: AppServerClient
  service: ThreadService
} {
  const env = { ...process.env }
  if (options.codexHome) env.CODEX_HOME = resolve(options.codexHome)
  const runtime = new CodexRuntime(
    { load: async () => ({ customCliPath: options.codexBinary?.trim() || null }) },
    env
  )
  const client = new AppServerClient(runtime, {
    name: 'codex_threadbox_cli',
    title: 'Threadbox CLI',
    version: '0.3.0'
  })
  return { runtime, client, service: new ThreadService(client) }
}
