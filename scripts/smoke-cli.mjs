import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const executable = resolve('packages/cli/dist/threadbox.cjs')
const fakeCli = resolve(
  'tests', 'fixtures', 'bin', process.platform === 'win32' ? 'codex.cmd' : 'codex'
)
const codexHome = await mkdtemp(join(tmpdir(), 'threadbox-cli-home-'))
const logPath = join(codexHome, 'fake-server.log')
const baseEnvironment = {
  ...process.env,
  CODEX_HOME: codexHome,
  THREADBOX_FAKE_LOG: logPath,
  THREADBOX_TEST_DISABLE_PROCESS_SCAN: '1'
}

function run(args, environment = {}) {
  return spawnSync(process.execPath, [executable, '--codex-binary', fakeCli, '--json', ...args], {
    encoding: 'utf8',
    env: { ...baseEnvironment, ...environment }
  })
}

function parsed(result) {
  if (!result.stdout.trim()) throw new Error(`CLI did not emit JSON:\n${result.stderr}`)
  return JSON.parse(result.stdout)
}

try {
  const status = run(['status'])
  if (status.status !== 0 || parsed(status).environment.cliVersion !== '0.150.1') {
    throw new Error(`CLI status smoke failed: ${status.stdout}\n${status.stderr}`)
  }

  const list = run(['list', '--state', 'archived', '--search', 'cleanup'])
  const listed = parsed(list)
  if (list.status !== 0 || listed.schemaVersion !== 1 || listed.records.length !== 1) {
    throw new Error(`CLI list smoke failed: ${list.stdout}\n${list.stderr}`)
  }

  const defaultList = parsed(run(['list']))
  const spawnedList = parsed(run(['list', '--include-spawned']))
  if (defaultList.records.length !== 3 || defaultList.records.some((record) => record.internal) ||
      spawnedList.records.length !== 4 || !spawnedList.records.some((record) => record.internal)) {
    throw new Error('CLI spawned-task visibility did not match the requested mode.')
  }

  const invalidLanguage = run(['--lang', 'fr', 'status'])
  if (invalidLanguage.status !== 2 || parsed(invalidLanguage).success !== false) {
    throw new Error('Invalid CLI language did not return a usage error.')
  }

  const parent = '019f0000-0000-7000-8000-000000000001'
  const child = '019f0000-0000-7000-8000-000000000002'
  const beforeDryRun = (await readFile(logPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
  const dryRun = run(['delete', '--dry-run', parent, child])
  const dryRunOutput = parsed(dryRun)
  const afterDryRun = (await readFile(logPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
    .slice(beforeDryRun.length)
  if (dryRun.status !== 0 || dryRunOutput.dryRun !== true ||
      dryRunOutput.preview.roots[0]?.id !== parent || dryRunOutput.preview.cascadedCount !== 1 ||
      afterDryRun.some((request) => request.method === 'thread/delete')) {
    throw new Error(`CLI dry-run smoke failed: ${dryRun.stdout}\n${dryRun.stderr}`)
  }

  const noConfirmation = run(['delete', '019f0000-0000-7000-8000-000000000001'])
  if (noConfirmation.status !== 2 || parsed(noConfirmation).success !== false) {
    throw new Error('Non-TTY deletion did not require --yes.')
  }

  const deletion = run(['delete', '--yes', parent, child])
  const deleted = parsed(deletion)
  if (deletion.status !== 0 || deleted.result.cascadedCount !== 1 ||
      deleted.result.succeeded.join(',') !== parent) {
    throw new Error(`CLI cascade smoke failed: ${deletion.stdout}\n${deletion.stderr}`)
  }

  const partial = run(['delete', '--yes', parent, '019f0000-0000-7000-8000-000000000004'], {
    THREADBOX_FAKE_FAIL_ID: parent
  })
  const partialResult = parsed(partial)
  if (partial.status !== 1 || partialResult.success !== false ||
      partialResult.result.failed.length !== 1 || partialResult.result.succeeded.length !== 1) {
    throw new Error(`CLI partial-failure smoke failed: ${partial.stdout}\n${partial.stderr}`)
  }

  const changedState = run(['delete', '--yes', parent], {
    THREADBOX_FAKE_ACTIVATE_CHILD_AFTER_PREVIEW: '1'
  })
  const changedStateResult = parsed(changedState)
  if (changedState.status !== 1 || changedStateResult.preview.roots[0]?.id !== parent ||
      changedStateResult.result.succeeded.length !== 0 ||
      changedStateResult.result.skipped[0]?.id !== parent) {
    throw new Error(`CLI state revalidation smoke failed: ${changedState.stdout}\n${changedState.stderr}`)
  }

  const requests = (await readFile(logPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse)
  const deleteIds = requests
    .filter((request) => request.method === 'thread/delete')
    .map((request) => request.params.threadId)
  if (!deleteIds.includes(parent) || deleteIds.filter((id) => id === child).length > 0) {
    throw new Error('CLI sent a duplicate descendant delete request.')
  }

  if (process.platform !== 'win32') {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const hanging = spawn(process.execPath, [
        executable, '--codex-binary', fakeCli, 'list'
      ], { env: { ...baseEnvironment, THREADBOX_FAKE_HANG: '1' }, stdio: 'ignore' })
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
      hanging.kill(signal)
      const [code] = await once(hanging, 'exit')
      if (code !== 130) throw new Error(`${signal} returned ${code} instead of 130.`)
    }
  }

  process.stdout.write('CLI fake-server smoke tests passed.\n')
} finally {
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
