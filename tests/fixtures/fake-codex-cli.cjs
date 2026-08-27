const readline = require('node:readline')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')

function fakeVersion() {
  if (process.env.THREADBOX_FAKE_VERSION_FILE) {
    return readFileSync(process.env.THREADBOX_FAKE_VERSION_FILE, 'utf8').trim()
  }
  return process.env.THREADBOX_FAKE_VERSION || '0.150.1'
}

if (process.argv.includes('--version')) {
  process.stdout.write(`codex-cli ${fakeVersion()}\n`)
  process.exit(0)
}

if (process.argv.includes('update')) {
  if (process.env.THREADBOX_FAKE_LOG) {
    appendFileSync(process.env.THREADBOX_FAKE_LOG, `${JSON.stringify({
      event: 'cli-update',
      args: process.argv.slice(2)
    })}\n`)
  }
  const finishUpdate = () => {
    if (process.env.THREADBOX_FAKE_UPDATE_FAIL === '1') {
      process.stderr.write('fake Codex update failed\n')
      process.exit(9)
    }
    if (process.env.THREADBOX_FAKE_VERSION_FILE) {
      writeFileSync(process.env.THREADBOX_FAKE_VERSION_FILE, '0.150.1\n', 'utf8')
    }
    process.stdout.write('fake Codex update completed\n')
    process.exit(0)
  }
  const delay = Number(process.env.THREADBOX_FAKE_UPDATE_DELAY_MS ?? 0)
  if (Number.isFinite(delay) && delay > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
  }
  finishUpdate()
}

if (!process.argv.includes('app-server')) {
  process.stderr.write('Expected app-server\n')
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)
const demoDirectory = process.env.THREADBOX_FAKE_WORKSPACE ||
  (process.platform === 'win32' ? 'C:\\dev\\threadbox' : '/home/demo/threadbox')
const projectDirectory = process.platform === 'win32' ? 'C:\\dev\\design-system' : '/home/demo/design-system'
const standaloneDirectory =
  process.platform === 'win32'
    ? 'C:\\Users\\demo\\Documents\\Codex\\2026-08-23\\cleanup'
    : '/home/demo/Documents/Codex/2026-08-23/cleanup'
const active = [
  {
    id: '019f0000-0000-7000-8000-000000000001',
    sessionId: 'session-1',
    forkedFromId: null,
    parentThreadId: null,
    preview: 'Review the desktop release workflow',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    modelProvider: 'openai',
    createdAt: now - 3600,
    updatedAt: now - 120,
    recencyAt: now - 120,
    status: { type: 'notLoaded' },
    path: null,
    cwd: demoDirectory,
    cliVersion: '0.150.1',
    source: 'vscode',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: 'Desktop release workflow',
    turns: []
  },
  {
    id: '019f0000-0000-7000-8000-000000000002',
    sessionId: 'session-1',
    forkedFromId: null,
    parentThreadId: '019f0000-0000-7000-8000-000000000001',
    preview: 'Internal verification task',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    modelProvider: 'openai',
    createdAt: now - 1800,
    updatedAt: now - 90,
    recencyAt: now - 90,
    status: { type: 'notLoaded' },
    path: null,
    cwd: demoDirectory,
    cliVersion: '0.150.1',
    source: { subAgent: { thread_spawn: { parent_thread_id: 'parent', depth: 1 } } },
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: []
  },
  {
    id: '019f0000-0000-7000-8000-000000000004',
    sessionId: 'session-3',
    forkedFromId: null,
    parentThreadId: null,
    preview: 'Review reusable component APIs',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: 'project-design-system',
    modelProvider: 'openai',
    createdAt: now - 7200,
    updatedAt: now - 240,
    recencyAt: now - 240,
    status: { type: 'notLoaded' },
    path: null,
    cwd: projectDirectory,
    cliVersion: '0.150.1',
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: 'Project design review',
    turns: []
  }
]
const archived = [
  {
    ...active[0],
    id: '019f0000-0000-7000-8000-000000000003',
    sessionId: 'session-2',
    preview: 'Clean up old project tasks',
    name: 'Archived cleanup',
    parentThreadId: null,
    projectId: null,
    cwd: standaloneDirectory,
    source: 'appServer',
    createdAt: now - 86_400,
    updatedAt: now - 43_200
  }
]
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function log(message) {
  if (process.env.THREADBOX_FAKE_LOG) {
    appendFileSync(process.env.THREADBOX_FAKE_LOG, `${JSON.stringify(message)}\n`)
  }
}

log({ event: 'server-start', pid: process.pid })
let activeListRequests = 0
let createdThreadSequence = 0
const created = new Map()

function findThread(threadId) {
  return active.find((item) => item.id === threadId) ??
    archived.find((item) => item.id === threadId) ??
    created.get(threadId)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  log(message)
  const failId = process.env.THREADBOX_FAKE_FAIL_ID
  if (failId && message.id !== undefined && message.params?.threadId === failId) {
    send({ id: message.id, error: { code: -32000, message: 'fake mutation failure' } })
    return
  }
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex' } })
  } else if (message.method === 'thread/list') {
    if (process.env.THREADBOX_FAKE_HANG === '1') return
    if (!message.params.archived && !message.params.isPinned) activeListRequests += 1
    const activeData =
      process.env.THREADBOX_FAKE_ACTIVATE_CHILD_AFTER_PREVIEW === '1' && activeListRequests > 1
        ? active.map((item) => item.id === '019f0000-0000-7000-8000-000000000002'
            ? { ...item, status: { type: 'active', activeFlags: [] } }
            : item)
        : active
    send({
      id: message.id,
      result: {
        data: message.params.isPinned ? [] : message.params.archived ? archived : activeData,
        nextCursor: null,
        backwardsCursor: null
      }
    })
  } else if (message.method === 'thread/start') {
    createdThreadSequence += 1
    const id = `019f0000-0000-7000-9000-${String(createdThreadSequence).padStart(12, '0')}`
    const thread = {
      ...active[0],
      id,
      sessionId: id,
      parentThreadId: null,
      preview: '',
      projectId: message.params.projectId ?? null,
      cwd: message.params.cwd,
      name: null,
      createdAt: now,
      updatedAt: now
    }
    // Real App Server keeps a blank task readable by ID but omits it from
    // thread/list until the conversation has a first turn.
    created.set(id, thread)
    send({ id: message.id, result: { thread } })
  } else if (message.method === 'thread/name/set') {
    const thread = findThread(message.params.threadId)
    if (thread) thread.name = message.params.name
    send({ id: message.id, result: {} })
  } else if (message.method === 'thread/read') {
    const thread = findThread(message.params.threadId)
    if (thread) send({ id: message.id, result: { thread } })
    else send({ id: message.id, error: { code: -32000, message: `thread not loaded: ${message.params.threadId}` } })
  } else if (message.method === 'thread/delete') {
    const activeIndex = active.findIndex((item) => item.id === message.params.threadId)
    if (activeIndex >= 0) active.splice(activeIndex, 1)
    const archivedIndex = archived.findIndex((item) => item.id === message.params.threadId)
    if (archivedIndex >= 0) archived.splice(archivedIndex, 1)
    created.delete(message.params.threadId)
    send({ id: message.id, result: {} })
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} })
  }
})
