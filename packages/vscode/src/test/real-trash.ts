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

async function run(): Promise<void> {
  const executable = process.argv[2]
  assert(executable, 'Pass the Codex executable path. No default real home is allowed.')
  const directory = await mkdtemp(join(tmpdir(), 'threadbox-real-trash-'))
  const runtime = new CodexRuntime({ load: async () => ({ customCliPath: executable }) }, {
    ...process.env, CODEX_HOME: directory
  })
  const descriptor = {
    name: 'threadbox_isolated_trash_smoke', title: 'Threadbox isolated Trash smoke', version: '0.9.4',
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
    try {
      created = await createProjectThread(creator, project, 'Disposable Trash smoke', directory,
        (id, projectId) => store.assignCreatedThread(id, projectId))
      const locked = await controller.trash([created.threadId])
      assert.deepEqual(locked.succeeded, [], 'A foreign writer must not be bypassed.')
      assert.match(locked.failed[0]?.message ?? '', /already has an active writer/)
      assert.deepEqual(await store.listTrashRoots(), [], 'A failed archive must not create a Trash assignment.')
    } finally { creator.stop() }
    const trashed = await controller.trash([created.threadId])
    assert.deepEqual(trashed.succeeded, [created.threadId], JSON.stringify(trashed))
    assert.deepEqual(await store.listTrashRoots(), [created.threadId])
    const restored = await controller.restore([created.threadId])
    assert.deepEqual(restored.succeeded, [created.threadId], JSON.stringify(restored))
    assert.equal((await store.list()).assignments[created.threadId], project.id)
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
      isolatedHome: directory
    }))
  } finally {
    creator.stop()
    client.stop()
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
