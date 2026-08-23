import { spawnSync } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
const output = resolve(packageRoot, `../../dist/threadbox-for-codex-${manifest.version}.vsix`)
const require = createRequire(import.meta.url)
const vsce = resolve(dirname(require.resolve('@vscode/vsce/package.json')), 'vsce')

await mkdir(dirname(output), { recursive: true })

const result = spawnSync(process.execPath, [
  vsce,
  'package',
  '--no-dependencies',
  '--out',
  output
], {
  cwd: packageRoot,
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
