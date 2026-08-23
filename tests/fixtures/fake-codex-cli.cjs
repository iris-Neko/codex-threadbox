const readline = require('node:readline')

if (process.argv.includes('--version')) {
  process.stdout.write('codex-cli 0.149.0\n')
  process.exit(0)
}

if (!process.argv.includes('app-server')) {
  process.stderr.write('Expected app-server\n')
  process.exit(1)
}

const now = Math.floor(Date.now() / 1000)
const demoDirectory = process.platform === 'win32' ? 'C:\\dev\\threadbox' : '/home/demo/threadbox'
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
    cliVersion: '0.149.0',
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
    cliVersion: '0.149.0',
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
    cliVersion: '0.149.0',
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

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex' } })
  } else if (message.method === 'thread/list') {
    send({
      id: message.id,
      result: {
        data: message.params.archived ? archived : active,
        nextCursor: null,
        backwardsCursor: null
      }
    })
  } else if (message.id !== undefined) {
    send({ id: message.id, result: {} })
  }
})
