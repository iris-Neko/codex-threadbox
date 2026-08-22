import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve('src/shared/protocol/generated')
const executable = resolve('node_modules', '@openai', 'codex', 'bin', 'codex.js')

rmSync(output, { recursive: true, force: true })

const result = spawnSync(
  process.execPath,
  [executable, 'app-server', 'generate-ts', '--out', output],
  { stdio: 'inherit' }
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
