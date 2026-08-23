import { input } from '@inquirer/prompts'
import { Command, CommanderError } from 'commander'
import type { BatchOperationResult } from '../../../src/shared/contracts'
import { runInteractive } from './interactive'
import {
  errorEnvelope,
  filterList,
  formatThreadTable,
  listEnvelope,
  operationSucceeded,
  resultEnvelope,
  statusEnvelope,
  type ListOptions
} from './output'
import { createCliRuntime, type CliRuntimeOptions } from './runtime'

interface GlobalOptions extends CliRuntimeOptions {
  json?: boolean
  lang?: string
}

let stopActiveClient: (() => void) | null = null

class CliUsageError extends Error {}

function language(value?: string): 'en' | 'zh-CN' {
  if (value === 'en' || value === 'zh-CN') return value
  return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en'
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function writeError(command: string, message: string, json: boolean): void {
  if (json) writeJson(errorEnvelope(command, message))
  else process.stderr.write(`threadbox: ${message}\n`)
}

async function withRuntime<T>(
  options: GlobalOptions,
  callback: (context: ReturnType<typeof createCliRuntime>) => Promise<T>
): Promise<T> {
  const context = createCliRuntime(options)
  stopActiveClient = () => context.client.stop()
  try {
    return await callback(context)
  } finally {
    context.client.stop()
    stopActiveClient = null
  }
}

function printResult(command: string, result: BatchOperationResult, json: boolean): number {
  const ok = operationSucceeded(result)
  if (json) writeJson(resultEnvelope(command, ok, result))
  else {
    process.stdout.write(
      `${command}: ${result.succeeded.length} succeeded, ${result.failed.length} failed, ${result.skipped.length} skipped\n`
    )
    for (const failure of [...result.failed, ...result.skipped]) {
      process.stderr.write(`${failure.id}: ${failure.message}\n`)
    }
  }
  return ok ? 0 : 1
}

async function confirmDelete(ids: string[], yes: boolean): Promise<boolean> {
  if (yes) return true
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliUsageError('Permanent deletion in a non-interactive terminal requires --yes.')
  }
  process.stderr.write(`Permanently delete ${ids.length} selected task(s) and spawned descendants.\n`)
  return await input({ message: 'Type DELETE to continue' }) === 'DELETE'
}

async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name('threadbox')
    .description('Headless task manager for Codex App Server')
    .version('0.3.0')
    .option('--codex-binary <path>', 'Codex executable path or command')
    .option('--codex-home <path>', 'Codex home directory')
    .option('--lang <language>', 'Interface language: en or zh-CN')
    .option('--json', 'Emit versioned JSON without ANSI output')
    .showHelpAfterError()
    .exitOverride()

  program.configureOutput({
    writeErr: (value) => {
      if (!argv.includes('--json')) process.stderr.write(value)
    }
  })

  program.action(async () => {
    const options = program.opts<GlobalOptions>()
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      if (options.json) writeJson(errorEnvelope('threadbox', 'Interactive mode requires a TTY.'))
      else program.outputHelp()
      process.exitCode = 2
      return
    }
    process.exitCode = await withRuntime(options, ({ service }) =>
      runInteractive(service, language(options.lang))
    )
  })

  program
    .command('status')
    .description('Show Codex environment status')
    .action(async () => {
      const options = program.opts<GlobalOptions>()
      const status = await withRuntime(options, ({ runtime }) => runtime.probe(true))
      if (options.json) writeJson(statusEnvelope('status', status.status))
      else {
        process.stdout.write(`Codex: ${status.status.state}\n`)
        process.stdout.write(`Binary: ${status.status.cliPath ?? '-'}\n`)
        process.stdout.write(`Version: ${status.status.cliVersion ?? '-'}\n`)
        if (status.status.message) process.stderr.write(`${status.status.message}\n`)
      }
      process.exitCode = status.status.state === 'ready' ? 0 : 2
    })

  program
    .command('list')
    .description('List active and archived tasks')
    .option('--state <state>', 'all, active, or archived', 'all')
    .option('--source <source>', 'Filter by source')
    .option('--cwd <path>', 'Filter by exact working directory')
    .option('--search <text>', 'Search task metadata')
    .option('--sort <mode>', 'updated-desc, updated-asc, created-desc, or title-asc', 'updated-desc')
    .action(async (listOptions: ListOptions) => {
      const options = program.opts<GlobalOptions>()
      const listed = await withRuntime(options, ({ service }) => service.listThreads())
      const threads = filterList(listed.threads, listOptions)
      if (options.json) writeJson(listEnvelope('list', listed.environment, threads))
      else {
        process.stdout.write(`${formatThreadTable(threads)}${threads.length > 0 ? '\n' : ''}`)
        process.stdout.write(`${threads.length} task(s)\n`)
        if (listed.environment.externalCodexProcesses > 0) {
          process.stderr.write(
            `Warning: ${listed.environment.externalCodexProcesses} other Codex process(es) may hide running state.\n`
          )
        }
      }
    })

  for (const mutation of ['archive', 'unarchive', 'pin', 'unpin'] as const) {
    program
      .command(`${mutation} <ids...>`)
      .description(`${mutation} explicit task IDs`)
      .action(async (ids: string[]) => {
        const options = program.opts<GlobalOptions>()
        const result = await withRuntime(options, ({ service }) => {
          if (mutation === 'archive') return service.archiveThreads(ids)
          if (mutation === 'unarchive') return service.unarchiveThreads(ids)
          return service.setPinned(ids, mutation === 'pin')
        })
        process.exitCode = printResult(mutation, result, Boolean(options.json))
      })
  }

  program
    .command('delete <ids...>')
    .description('Permanently delete explicit task IDs and spawned descendants')
    .option('-y, --yes', 'Skip the typed confirmation')
    .action(async (ids: string[], commandOptions: { yes?: boolean }) => {
      const options = program.opts<GlobalOptions>()
      if (!await confirmDelete(ids, Boolean(commandOptions.yes))) {
        process.exitCode = 130
        return
      }
      const result = await withRuntime(options, ({ service }) =>
        service.deleteThreads(ids, { trashWorkingDirectories: [] })
      )
      process.exitCode = printResult('delete', result, Boolean(options.json))
    })

  try {
    await program.parseAsync(['node', 'threadbox', ...argv])
    return typeof process.exitCode === 'number' ? process.exitCode : 0
  } catch (error) {
    if (error instanceof CommanderError && error.code === 'commander.helpDisplayed') return 0
    if (error instanceof CommanderError && error.code === 'commander.version') return 0
    if (error instanceof Error && error.name === 'ExitPromptError') return 130
    const options = program.opts<GlobalOptions>()
    const message = error instanceof Error ? error.message : String(error)
    const command = program.args[0] ?? 'threadbox'
    writeError(command, message, Boolean(options.json))
    if (error instanceof CommanderError || error instanceof CliUsageError) return 2
    return ['archive', 'unarchive', 'pin', 'unpin', 'delete'].includes(command) ? 1 : 2
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopActiveClient?.()
    process.exit(130)
  })
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  writeError('threadbox', message, process.argv.includes('--json'))
  process.exitCode = 2
})
