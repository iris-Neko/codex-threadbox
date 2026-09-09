import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const directory = resolve(process.argv[2] ?? 'release-artifacts')
const targets = [
  'windows-x64.exe', 'windows-x64.zip',
  'macos-x64.dmg', 'macos-x64.zip', 'macos-arm64.dmg', 'macos-arm64.zip',
  'linux-x64.AppImage', 'linux-x64.deb', 'linux-x64.flatpak'
]
for (const target of targets) {
  const name = `Threadbox-for-Codex-${version}-${target}`
  const info = await stat(join(directory, name))
  if (!info.isFile() || info.size < 1_000_000) throw new Error(`Missing or invalid release artifact: ${name}`)
}
console.log(`Verified ${targets.length} desktop ${version} artifacts.`)
