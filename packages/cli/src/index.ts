import { input } from '@inquirer/prompts'
import { Command, CommanderError } from 'commander'
import type { BatchOperationResult, DeletePreview } from '../../../src/shared/contracts'
import { runInteractive } from './interactive'
import { parseLanguage, resolveLanguage } from './options'
import {
  errorEnvelope,
  filterList,
  formatThreadTable,
  listEnvelope,
  operationSucceeded,
  previewEnvelope,
  resultEnvelope,
  statusEnvelope,
  type ListOptions
} from './output'
import { createCliRuntime, type CliRuntimeOptions } from './runtime'
import { CLI_VERSION } from './version'

interface GlobalOptions extends CliRuntimeOptions {
  json?: boolean
  lang?: string
}

let stopActiveClient: (() => void) | null = null

class CliUsageError extends Error {}

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

function printResult(
  command: string,
  result: BatchOperationResult,
  json: boolean,
  preview?: DeletePreview
): number {
  const ok = operationSucceeded(result)
  if (json) writeJson(resultEnvelope(command, ok, result, preview))
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

function deletePreviewText(preview: DeletePreview): string {
  const lines = [
    `Delete preview: ${preview.roots.length} root task(s), ${preview.cascadedCount} spawned descendant(s).`
  ]
  for (const root of preview.roots) {
    lines.push(`- ${root.title} [${root.id}]`)
    lines.push(`  ${root.cwd}${root.descendantCount > 0 ? ` (+${root.descendantCount} spawned)` : ''}`)
  }
  if (preview.skipped.length > 0) {
    lines.push('Skipped:')
    for (const item of preview.skipped) lines.push(`- ${item.id}: ${item.message}`)
  }
  return `${lines.join('\n')}\n`
}

async function confirmDelete(preview: DeletePreview, yes: boolean): Promise<boolean> {
  if (yes) return true
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliUsageError('Permanent deletion in a non-interactive terminal requires --yes.')
  }
  return await input({
    message: `Type DELETE to permanently delete ${preview.roots.length} root task(s)`
  }) === 'DELETE'
}

async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name('threadbox')
    .description('Headless task manager for Codex App Server')
    .version(CLI_VERSION)
    .option('--codex-binary <path>', 'Codex executable path or command')
    .option('--codex-home <path>', 'Codex home directory')
    .option('--lang <language>', 'Interface language: en or zh-CN')
    .option('--json', 'Emit versioned JSON without ANSI output')
    .showHelpAfterError()
    .exitOverride()

  program.hook('preAction', () => {
    const value = program.opts<GlobalOptions>().lang
    if (value) {
      try {
        parseLanguage(value)
      } catch (error) {
        throw new CliUsageError(error instanceof Error ? error.message : String(error))
      }
    }
  })

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
      runInteractive(service, resolveLanguage(options.lang))
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
    .option('--include-spawned', 'Include internal spawned tasks')
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
    .option('--dry-run', 'Preview the final deletion set without deleting')
    .action(async (ids: string[], commandOptions: { yes?: boolean; dryRun?: boolean }) => {
      const options = program.opts<GlobalOptions>()
      process.exitCode = await withRuntime(options, async ({ service }) => {
        const preview = await service.previewDeleteThreads(ids)
        if (commandOptions.dryRun) {
          if (options.json) writeJson(previewEnvelope('delete', preview))
          else process.stdout.write(deletePreviewText(preview))
          return preview.skipped.length === 0 && preview.roots.length > 0 ? 0 : 1
        }

        if (!options.json) process.stderr.write(deletePreviewText(preview))
        if (preview.roots.length > 0 && !await confirmDelete(preview, Boolean(commandOptions.yes))) {
          return 130
        }
        const result = await service.deleteThreads(ids, { trashWorkingDirectories: [] })
        return printResult('delete', result, Boolean(options.json), preview)
      })
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
