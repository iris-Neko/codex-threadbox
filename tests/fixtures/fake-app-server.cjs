const readline = require('node:readline')

let initialized = false
const reader = readline.createInterface({ input: process.stdin })

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

reader.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', platformFamily: 'test', platformOs: 'test' } })
    return
  }
  if (message.method === 'initialized') {
    initialized = true
    return
  }
  if (message.method === 'test/echo') {
    send({ method: 'thread/status/changed', params: { threadId: 'ignored' } })
    send({ id: message.id, result: { initialized, value: message.params } })
    return
  }
  if (message.method === 'test/timeout') return
  if (message.method === 'test/crash') {
    process.exit(2)
  }
  send({ id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } })
})
