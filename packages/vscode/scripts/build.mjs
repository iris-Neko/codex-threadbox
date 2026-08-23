import { build } from 'esbuild'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const dist = resolve(packageRoot, 'dist')
const testDist = resolve(packageRoot, 'test-dist')
await rm(dist, { recursive: true, force: true })
await rm(testDist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await mkdir(testDist, { recursive: true })

await Promise.all([
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
    entryPoints: [resolve(packageRoot, 'src/webview.tsx')],
    outfile: resolve(dist, 'webview.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    legalComments: 'none',
    loader: { '.css': 'css' }
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
  copyFile(resolve(packageRoot, '../../resources/icon.png'), resolve(dist, 'icon.png'))
])

const webviewBundle = await readFile(resolve(dist, 'webview.js'), 'utf8')
if (webviewBundle.includes('React.createElement(')) {
  throw new Error('Webview bundle contains classic JSX output without a guaranteed React binding.')
}
