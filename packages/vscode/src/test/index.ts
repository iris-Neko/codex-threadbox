import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
      'irisNeko.codex-threadbox-vscode'
    )
    assert(extension, 'Threadbox extension was not discovered.')
    const manifest = extension.packageJSON as {
      contributes?: { configuration?: { properties?: Record<string, { default?: unknown }> } }
    }
    assert(
      manifest.contributes?.configuration?.properties?.['threadbox.sidebarLocation']?.default === 'codex',
      'Threadbox did not default to the Codex sidebar.'
    )
    const exported = await extension.activate()
    const api = exported.getThreadboxApi()
    const capabilities = await api.getPlatformCapabilities()
    assert(capabilities.host === 'vscode', 'VS Code capabilities were not returned.')
    assert(capabilities.projectManagement, 'VS Code project management was not enabled.')
    assert(capabilities.projectThreadCreation, 'VS Code project task creation was not enabled.')
    assert(capabilities.workspaceProjectImport, 'VS Code workspace project import was not enabled.')
    assert(capabilities.taskTrash, 'VS Code task Trash was not enabled.')
    assert(!capabilities.directoryTrash, 'VS Code must not expose directory deletion.')
    assert(!capabilities.desktopRecentsRepair, 'VS Code must not expose Recents repair.')

    const status = await api.getEnvironmentStatus()
    assert(status.state === 'ready' && status.cliVersion === '0.149.0', 'Fake Codex was not ready.')
    const listed = await api.listThreads()
    assert(listed.threads.length === 4, 'VS Code did not load active and archived fake tasks.')
    assert(api.importCurrentWorkspaceProject, 'VS Code did not expose workspace project import.')
    const seed = await api.createProject('Workspace import seed')
    const seedProject = seed.projects.find((item) => item.name === 'Workspace import seed')
    assert(seedProject, 'VS Code did not create the workspace import seed project.')
    await api.assignThreads(['019f0000-0000-7000-8000-000000000001'], seedProject.id)
    const imported = await api.importCurrentWorkspaceProject()
    assert(imported, 'VS Code did not import the current workspace.')
    const importedProjectId = imported.assignments['019f0000-0000-7000-8000-000000000001']
    assert(importedProjectId, 'VS Code did not assign the matching workspace root task.')
    assert(!imported.assignments['019f0000-0000-7000-8000-000000000002'],
      'VS Code persisted a spawned child instead of its root task.')
    assert(!imported.projects.some((item) => item.kind === 'official'),
      'VS Code exposed an App Server project as a manageable project.')
    const created = await api.createProject('Extension test')
    const trashProject = created.projects.find((item) => item.systemKind === 'trash')
    assert(trashProject?.readOnly && !trashProject.canCreateThread,
      'VS Code did not expose the built-in read-only Trash project.')
    const project = created.projects.find((item) =>
      item.kind === 'threadbox' && item.systemKind !== 'trash')
    assert(project, 'VS Code did not create a Threadbox project.')
    const assigned = await api.assignThreads(['019f0000-0000-7000-8000-000000000002'], project.id)
    assert(Object.values(assigned.assignments).includes(project.id), 'VS Code did not assign the task.')
    assert(api.createThreadInProject, 'VS Code did not expose project task creation.')
    const localThread = await api.createThreadInProject(project.id, 'Threadbox project task')
    assert(localThread?.projectId === project.id, 'VS Code did not create a Threadbox project task.')
    assert(api.trashThreads && api.restoreThreadsFromTrash && api.emptyTrash,
      'VS Code did not expose task Trash operations.')
    const trashed = await api.trashThreads([localThread.threadId])
    assert(trashed.succeeded.includes(localThread.threadId), 'VS Code did not move the task to Trash.')
    const afterTrash = await api.listProjects()
    assert(afterTrash.assignments[localThread.threadId] === trashProject.id,
      'VS Code did not store the task in the built-in Trash project.')
    const restored = await api.restoreThreadsFromTrash([localThread.threadId])
    assert(restored.succeeded.includes(localThread.threadId), 'VS Code did not restore the task from Trash.')
    const afterRestore = await api.listProjects()
    assert(afterRestore.assignments[localThread.threadId] === project.id,
      'VS Code did not restore the task to its previous Threadbox project.')
    const disposableThread = await api.createThreadInProject(project.id, 'Disposable task')
    assert(disposableThread, 'VS Code did not create the task used to test Empty Trash.')
    await api.trashThreads([disposableThread.threadId])
    const emptied = await api.emptyTrash()
    assert(emptied.succeeded.includes(disposableThread.threadId), 'VS Code did not empty Trash.')
    assert(!(await api.listThreads()).threads.some((item) => item.id === disposableThread.threadId),
      'Empty Trash did not permanently remove the task record.')
    const renamed = await api.renameProject(project.id, 'Renamed extension test')
    assert(renamed.projects.some((item) => item.name === 'Renamed extension test'),
      'VS Code did not rename the project.')
    const deleted = await api.deleteProject(project.id)
    assert(!deleted.projects.some((item) => item.id === project.id), 'VS Code did not delete the project.')
    const result = await api.archiveThreads(['019f0000-0000-7000-8000-000000000001'])
    assert(result.succeeded.length === 1, 'VS Code archive operation did not complete.')
    const commands = await vscode.commands.getCommands(true)
    assert(commands.includes('threadbox.refreshSidebar'), 'Threadbox sidebar refresh was not registered.')
    assert(commands.includes('threadbox.searchSidebar'), 'Threadbox sidebar search was not registered.')
    assert(commands.includes('threadbox.clearSidebarSearch'), 'Threadbox search reset was not registered.')
    assert(commands.includes('threadbox.newProject'), 'Threadbox project commands were not registered.')
    assert(commands.includes('threadbox.importCurrentWorkspaceProject'),
      'Threadbox workspace import command was not registered.')
    assert(commands.includes('threadbox.newThreadInProject'),
      'Threadbox project task creation command was not registered.')
    assert(commands.includes('threadbox.moveToProject'), 'Threadbox task move command was not registered.')
    assert(commands.includes('threadbox.restoreFromTrash'), 'Threadbox Trash restore command was not registered.')
    assert(commands.includes('threadbox.emptyTrash'), 'Threadbox Empty Trash command was not registered.')
    assert(commands.includes('threadbox.openInCodex'), 'Threadbox Codex task command was not registered.')
    assert(commands.includes('threadbox.openInCodexOnDoubleClick'),
      'Threadbox double-click task command was not registered.')
    await vscode.commands.executeCommand('threadbox.refreshSidebar')
    await vscode.commands.executeCommand('threadbox.openManager')
    const fakeLog = process.env.THREADBOX_FAKE_LOG
    assert(fakeLog, 'THREADBOX_FAKE_LOG was not provided.')
    const appServerMessages = (await readFile(fakeLog, 'utf8')).trim().split(/\r?\n/)
      .map((line) => JSON.parse(line) as { method?: string })
    assert(!appServerMessages.some((message) => message.method?.startsWith('project/')),
      'VS Code sent an unsupported project/* request to App Server.')
  } finally {
    await configuration.update('codexBinary', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('codexHome', undefined, vscode.ConfigurationTarget.Global)
    await configuration.update('language', undefined, vscode.ConfigurationTarget.Global)
    await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}
