import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { ThreadboxExtensionApi } from '../extension'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function run(): Promise<void> {
  const fakeCli = process.env.THREADBOX_TEST_FAKE_CLI
  assert(fakeCli, 'THREADBOX_TEST_FAKE_CLI was not provided.')
  const codexHome = await mkdtemp(join(tmpdir(), 'threadbox-vscode-home-'))
  const configuration = vscode.workspace.getConfiguration('threadbox')
  try {
    await configuration.update('codexBinary', fakeCli, vscode.ConfigurationTarget.Global)
    await configuration.update('codexHome', codexHome, vscode.ConfigurationTarget.Global)
    await configuration.update('language', 'en', vscode.ConfigurationTarget.Global)

    const extension = vscode.extensions.getExtension<ThreadboxExtensionApi>(
      'irisNeko.threadbox-for-codex'
    )
    assert(extension, 'Threadbox extension was not discovered.')
    const exported = await extension.activate()
    const api = exported.getThreadboxApi()
    const capabilities = await api.getPlatformCapabilities()
    assert(capabilities.host === 'vscode', 'VS Code capabilities were not returned.')
    assert(!capabilities.directoryTrash, 'VS Code must not expose directory deletion.')
    assert(!capabilities.desktopRecentsRepair, 'VS Code must not expose Recents repair.')

    const status = await api.getEnvironmentStatus()
    assert(status.state === 'ready' && status.cliVersion === '0.149.0', 'Fake Codex was not ready.')
    const listed = await api.listThreads()
    assert(listed.threads.length === 4, 'VS Code did not load active and archived fake tasks.')
    const result = await api.archiveThreads(['019f0000-0000-7000-8000-000000000001'])
    assert(result.succeeded.length === 1, 'VS Code archive operation did not complete.')
    await vscode.commands.executeCommand('threadbox.openManager')
  } finally {
    await configuration.update('codexBinary', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('codexHome', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('language', undefined, vscode.ConfigurationTarget.Global)
    await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
