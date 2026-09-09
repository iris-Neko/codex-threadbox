import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const tag = process.env.RELEASE_TAG
const repo = process.env.GITHUB_REPOSITORY
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('Invalid desktop tag.')
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })
const fetchRelease = () => JSON.parse(gh('api', `repos/${repo}/releases/tags/${tag}`))
const release = fetchRelease()
if (release.draft || release.prerelease) throw new Error('Expected an already published stable release.')
const directory = resolve(process.argv[2])
const files = (await readdir(directory)).filter((name) => name.endsWith('.rpm'))
if (files.length !== 1) throw new Error('Expected exactly one RPM.')
const name = `Threadbox-for-Codex-${tag.slice(1)}-linux-x64.rpm`
const rpm = join(directory, name)
if (files[0] !== name) await rename(join(directory, files[0]), rpm)
const hash = createHash('sha256').update(await readFile(rpm)).digest('hex')
const temporary = await mkdtemp(join(tmpdir(), 'threadbox-rpm-publish-'))
try {
  gh('release', 'download', tag, '--repo', repo, '--pattern', 'SHA256SUMS.txt', '--dir', temporary)
  const checksumPath = join(temporary, 'SHA256SUMS.txt')
  const contents = await readFile(checksumPath, 'utf8')
  const sums = new Map(contents.trim().split('\n').map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+\.\/(.+)$/)
    if (!match) throw new Error('Invalid existing checksum manifest.')
    return [match[2], match[1]]
  }))
  for (const asset of release.assets.filter((item) => item.name !== 'SHA256SUMS.txt' && item.name !== name)) {
    if (asset.digest !== `sha256:${sums.get(asset.name)}`) throw new Error(`Existing asset checksum mismatch: ${asset.name}`)
  }
  const existing = release.assets.find((asset) => asset.name === name)
  if (existing && existing.digest !== `sha256:${hash}`) throw new Error('A different RPM already exists; it will not be replaced.')
  if (!existing) gh('release', 'upload', tag, rpm, '--repo', repo)
  sums.set(name, hash)
  await writeFile(checksumPath, [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => `${digest}  ./${file}\n`).join(''))
  gh('release', 'upload', tag, checksumPath, '--repo', repo, '--clobber')
  if (!(release.body ?? '').includes('linux-x64.rpm')) {
    const notes = join(temporary, 'notes.md')
    await writeFile(notes, `${release.body ?? ''}\n\n### RPM package / RPM 安装包\n\nAdded Linux x64 RPM, verified by installing on Fedora.\n\n\`sudo dnf install ./Threadbox-for-Codex-${tag.slice(1)}-linux-x64.rpm\`\n\n已补充 Linux x64 RPM 安装包，并更新 SHA256SUMS.txt；原有安装附件保持不变。\n`)
    gh('release', 'edit', tag, '--repo', repo, '--notes-file', notes)
  }
  const final = fetchRelease()
  for (const [file, digest] of sums) {
    if (final.assets.find((asset) => asset.name === file)?.digest !== `sha256:${digest}`) throw new Error(`Uploaded checksum mismatch: ${file}`)
  }
  console.log(`Published ${name}; all ${sums.size} installer checksums verified.`)
} finally { await rm(temporary, { recursive: true, force: true }) }
