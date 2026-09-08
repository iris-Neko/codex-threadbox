import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppServerClient } from '../../../core/src/app-server-client'
import { CodexRuntime } from '../../../core/src/codex-runtime'
import { ThreadService } from '../../../core/src/thread-service'
import { createProjectThread } from '../codex-projects'
import { ProjectStore } from '../project-store'
import { TrashController } from '../trash-controller'
import { knownCodexExecutables, LinuxWriterRecovery } from '../linux-writer-recovery'
import { recoverWriterAndTrash } from '../writer-recovery'
import { renameThread } from '../rename-thread'

async function run(): Promise<void> {
  const executable = process.argv[2]
  assert(executable, 'Pass the Codex executable path. No default real home is allowed.')
  const directory = await mkdtemp(join(tmpdir(), 'threadbox-real-trash-'))
  const runtime = new CodexRuntime({ load: async () => ({ customCliPath: executable }) }, {
    ...process.env, CODEX_HOME: directory
  })
  const descriptor = {
    name: 'threadbox_isolated_trash_smoke', title: 'Threadbox isolated Trash smoke', version: '0.10.1',
    initializeCapabilities: { experimentalApi: true, requestAttestation: false }
  }
  const client = new AppServerClient(runtime, descriptor)
  const creator = new AppServerClient(runtime, descriptor)
  try {
    const service = new ThreadService(client)
    const initial = await service.listThreads()
    assert.equal(initial.threads.length, 0, 'Test home must start empty.')
    assert.equal(initial.environment.state, 'ready')
    const store = new ProjectStore(join(directory, 'threadbox', 'projects-v1.json'))
    const snapshot = await store.create('Trash smoke')
    const project = snapshot.projects.find((item) => item.name === 'Trash smoke')!
    const controller = new TrashController(service, store)
    let created
    let recovered: Awaited<ReturnType<typeof recoverWriterAndTrash>> | undefined
    try {
      created = await createProjectThread(creator, project, 'Disposable Trash smoke', directory,
        (id, projectId) => store.assignCreatedThread(id, projectId))
      await renameThread(client, created.threadId, 'Renamed while open', () => undefined)
        .catch((error: Error) => { throw new Error('Rename while open: ' + error.message) })
      const locked = await controller.trash([created.threadId])
      assert.deepEqual(locked.succeeded, [], 'A foreign writer must not be bypassed.')
      assert.match(locked.failed[0]?.message ?? '', /already has an active writer/)
      assert.deepEqual(await store.listTrashRoots(), [], 'A failed archive must not create a Trash assignment.')
      if (process.platform === 'linux' && process.argv[3]) {
        const allowed = await knownCodexExecutables(executable)
        const guard = (): void => { assert(directory.includes('threadbox-real-trash-')) }
        recovered = await recoverWriterAndTrash([created.threadId], {
          backend: new LinuxWriterRecovery(process.argv[3], directory, allowed, guard), guard,
          trash: (ids) => controller.trash(ids),
          inventory: async () => (await service.listThreads()).threads,
          preview: (ids) => service.previewDeleteThreads(ids),
          confirm: async (owner, _threads, force) => {
            assert(owner.locks.some((lock) => lock.id === created!.threadId))
            assert.equal(force, false, 'The disposable Codex backend should stop normally.')
            return true
          }
        })
        assert(recovered, 'Recovery unexpectedly cancelled.')
      }
    } finally { creator.stop() }
    const trashed = recovered ?? await controller.trash([created.threadId])
    assert.deepEqual(trashed.succeeded, [created.threadId], JSON.stringify(trashed))
    assert.deepEqual(await store.listTrashRoots(), [created.threadId])
    await assert.rejects(renameThread(client, created.threadId, 'Renamed in Trash', () => undefined), /Restore archived/)
    const restored = await controller.restore([created.threadId])
    assert.deepEqual(restored.succeeded, [created.threadId], JSON.stringify(restored))
    assert.equal((await store.list()).assignments[created.threadId], project.id)
    await renameThread(client, created.threadId, 'Renamed after restore', () => undefined)
    await controller.assign([created.threadId], await store.getTrashProjectId())
    const emptied = await controller.empty()
    assert.deepEqual(emptied.succeeded, [created.threadId], JSON.stringify(emptied))
    service.setSupplementalThreadReferences(await store.inventoryReferences())
    assert.equal((await service.listThreads()).threads.length, 0)
    await assert.rejects(client.request('thread/read', { threadId: created.threadId, includeTurns: false }))
    console.log(JSON.stringify({
      cli: initial.environment.cliVersion, pinning: initial.environment.capabilities.pinning,
      created: true, trashed: true, restored: true, dragToTrash: true, emptied: true,
      foreignWriterProtected: true, retryAfterRelease: true,
      pidfdRecoveryTested: Boolean(recovered),
      renamedWhileOpen: true, archivedRenameRequiresRestore: true, renamedAfterRestore: true,
      isolatedHome: directory
    }))
  } finally {
    creator.stop()
    client.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
