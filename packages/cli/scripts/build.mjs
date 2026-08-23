import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
await mkdir(resolve(packageRoot, 'dist'), { recursive: true })

await build({
  entryPoints: [resolve(packageRoot, 'src/index.ts')],
  outfile: resolve(packageRoot, 'dist/threadbox.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  legalComments: 'none'
})
