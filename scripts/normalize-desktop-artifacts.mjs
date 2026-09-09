import { access, readFile, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const directory = resolve(process.argv[2] ?? 'release-artifacts')
for (const [sourceArch, extension] of [['x86_64', 'AppImage'], ['x86_64', 'flatpak'], ['amd64', 'deb']]) {
  const from = join(directory, `Threadbox-for-Codex-${version}-linux-${sourceArch}.${extension}`)
  const to = join(directory, `Threadbox-for-Codex-${version}-linux-x64.${extension}`)
  try { await access(from) }
  catch (error) { if (error.code === 'ENOENT') continue; throw error }
  await rename(from, to)
}
