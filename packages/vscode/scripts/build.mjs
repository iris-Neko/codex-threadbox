import { build } from 'esbuild'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const packageRoot = resolve(import.meta.dirname, '..')
const dist = resolve(packageRoot, 'dist')
const testDist = resolve(packageRoot, 'test-dist')
const require = createRequire(import.meta.url)
await rm(dist, { recursive: true, force: true })
await rm(testDist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await mkdir(testDist, { recursive: true })

await Promise.all([
  build({
    entryPoints: [resolve(packageRoot, 'src/claude-history-worker.ts')],
    outfile: resolve(dist, 'claude-history-worker.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: 'import { createRequire as threadboxCreateRequire } from "node:module"; const require = threadboxCreateRequire(import.meta.url);' },
    legalComments: 'none'
  }),
  copyFile(resolve(require.resolve('@anthropic-ai/claude-agent-sdk'), '../LICENSE.md'), resolve(dist, 'CLAUDE_AGENT_SDK_LICENSE.md')),
  build({
    entryPoints: [resolve(packageRoot, 'src/extension.ts')],
    outfile: resolve(dist, 'extension.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    legalComments: 'none'
  }),

  build({
    entryPoints: [resolve(packageRoot, 'src/test/index.ts')],
    outfile: resolve(testDist, 'index.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    legalComments: 'none'
  }),
  copyFile(resolve(packageRoot, '../../resources/icon.png'), resolve(dist, 'icon.png')),
  copyFile(resolve(packageRoot, 'scripts/writer-recovery.py'), resolve(dist, 'writer-recovery.py')),
  copyFile(resolve(packageRoot, '../../resources/activitybar.svg'), resolve(dist, 'activitybar.svg'))
])
