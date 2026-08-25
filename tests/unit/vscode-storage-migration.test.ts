// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyProjectStorage } from '../../packages/vscode/src/storage-migration'

const temporaryDirectories: string[] = []

async function setup(): Promise<{ root: string; current: string; legacy: string }> {
  const root = await mkdtemp(join(tmpdir(), 'threadbox-storage-migration-'))
  temporaryDirectories.push(root)
  const current = join(root, 'irisneko.codex-threadbox-vscode')
  const legacy = join(root, 'irisneko.threadbox-for-codex')
  await mkdir(legacy, { recursive: true })
  return { root, current, legacy }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  ))
})

describe('VS Code legacy project storage migration', () => {
  it('copies the old extension project file into the new extension directory', async () => {
    const { current, legacy } = await setup()
    await writeFile(join(legacy, 'projects-v1.json'), '{"legacy":true}\n', 'utf8')

    await expect(migrateLegacyProjectStorage(current)).resolves.toBe(true)
    await expect(readFile(join(current, 'projects-v1.json'), 'utf8'))
      .resolves.toBe('{"legacy":true}\n')
  })

  it('never overwrites an existing current project file', async () => {
    const { current, legacy } = await setup()
    await mkdir(current, { recursive: true })
    await writeFile(join(legacy, 'projects-v1.json'), 'legacy', 'utf8')
    await writeFile(join(current, 'projects-v1.json'), 'current', 'utf8')

    await expect(migrateLegacyProjectStorage(current)).resolves.toBe(false)
    await expect(readFile(join(current, 'projects-v1.json'), 'utf8')).resolves.toBe('current')
  })
})
