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
    assert(capabilities.projectManagement, 'VS Code project management was not enabled.')
    assert(!capabilities.directoryTrash, 'VS Code must not expose directory deletion.')
    assert(!capabilities.desktopRecentsRepair, 'VS Code must not expose Recents repair.')

    const status = await api.getEnvironmentStatus()
    assert(status.state === 'ready' && status.cliVersion === '0.149.0', 'Fake Codex was not ready.')
    const listed = await api.listThreads()
    assert(listed.threads.length === 4, 'VS Code did not load active and archived fake tasks.')
    const created = await api.createProject('Extension test')
    const project = created.projects.find((item) => item.kind === 'threadbox')
    assert(project, 'VS Code did not create a Threadbox project.')
    const assigned = await api.assignThreads(['019f0000-0000-7000-8000-000000000002'], project.id)
    assert(Object.values(assigned.assignments).includes(project.id), 'VS Code did not assign the task.')
    const renamed = await api.renameProject(project.id, 'Renamed extension test')
    assert(renamed.projects.some((item) => item.name === 'Renamed extension test'),
      'VS Code did not rename the project.')
    const deleted = await api.deleteProject(project.id)
    assert(!deleted.projects.some((item) => item.id === project.id), 'VS Code did not delete the project.')
    const result = await api.archiveThreads(['019f0000-0000-7000-8000-000000000001'])
    assert(result.succeeded.length === 1, 'VS Code archive operation did not complete.')
    const commands = await vscode.commands.getCommands(true)
    assert(commands.includes('threadbox.refreshSidebar'), 'Threadbox sidebar refresh was not registered.')
    assert(commands.includes('threadbox.newProject'), 'Threadbox project commands were not registered.')
    assert(commands.includes('threadbox.moveToProject'), 'Threadbox task move command was not registered.')
    assert(commands.includes('threadbox.openInCodex'), 'Threadbox Codex task command was not registered.')
    await vscode.commands.executeCommand('threadbox.refreshSidebar')
    await vscode.commands.executeCommand('threadbox.openManager')
  } finally {
    await configuration.update('codexBinary', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('codexHome', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('language', undefined, vscode.ConfigurationTarget.Global)
    await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
