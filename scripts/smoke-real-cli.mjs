import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const codexHome = await mkdtemp(resolve(tmpdir(), 'threadbox-codex-home-'))
const executable = resolve('node_modules', '@openai', 'codex', 'bin', 'codex.js')
const child = spawn(process.execPath, [executable, 'app-server', '--stdio'], {
  env: { ...process.env, CODEX_HOME: codexHome },
  stdio: ['pipe', 'pipe', 'ignore']
})
const reader = createInterface({ input: child.stdout })
let nextId = 1
const pending = new Map()

function request(method, params = {}) {
  const id = nextId++
  child.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectPromise(new Error(`${method} timed out`))
    }, 15_000)
    pending.set(id, { resolvePromise, rejectPromise, timer })
  })
}

reader.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  const entry = pending.get(message.id)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(message.id)
  if (message.error) entry.rejectPromise(new Error(message.error.message))
  else entry.resolvePromise(message.result)
})

try {
  await request('initialize', {
    clientInfo: { name: 'codex_threadbox_smoke', title: 'Threadbox Smoke Test', version: '0.1.0' }
  })
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
  const result = await request('thread/list', {
    archived: false,
    limit: 10,
    useStateDbOnly: true
  })
  if (!Array.isArray(result.data)) throw new Error('thread/list did not return an array')
  process.stdout.write(`Real Codex app-server smoke test passed with ${result.data.length} isolated threads.\n`)
} finally {
  reader.close()
  if (child.exitCode === null) {
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  await rm(codexHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
