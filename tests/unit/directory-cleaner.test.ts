import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { parse, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkingDirectoryCleaner } from '../../src/main/directory-cleaner'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'threadbox-cleaner-'))
  temporaryDirectories.push(path)
  return path
}

describe('WorkingDirectoryCleaner', () => {
  it('moves a directory tree to Trash with one call and reports nested paths', async () => {
    const parent = await temporaryDirectory()
    const child = resolve(parent, 'nested')
    await mkdir(child)
    const calls: string[] = []
    const cleaner = new WorkingDirectoryCleaner(async (path) => {
      calls.push(path)
    }, [])

    const result = await cleaner.cleanup([child, parent])

    expect(calls).toEqual([parent])
    expect(result.trashed).toEqual(expect.arrayContaining([parent, child]))
    expect(result.failed).toEqual([])
  })

  it('refuses filesystem roots, the home directory, and application-containing paths', async () => {
    const protectedDirectory = await temporaryDirectory()
    const appPath = resolve(protectedDirectory, 'app', 'threadbox.exe')
    const calls: string[] = []
    const cleaner = new WorkingDirectoryCleaner(async (path) => {
      calls.push(path)
    }, [appPath])

    const rootResult = await cleaner.cleanup([parse(protectedDirectory).root])
    const homeResult = await cleaner.cleanup([homedir()])
    const protectedResult = await cleaner.cleanup([protectedDirectory])

    expect(calls).toEqual([])
    expect(rootResult.skipped[0]?.message).toMatch(/roots/)
    expect(homeResult.skipped[0]?.message).toMatch(/home directory/)
    expect(protectedResult.skipped[0]?.message).toMatch(/running Threadbox/)
  })

  it('keeps missing directories instead of calling Trash', async () => {
    const parent = await temporaryDirectory()
    const missing = resolve(parent, 'missing')
    const calls: string[] = []
    const cleaner = new WorkingDirectoryCleaner(async (path) => {
      calls.push(path)
    }, [])

    const result = await cleaner.cleanup([missing])

    expect(calls).toEqual([])
    expect(result.skipped[0]?.message).toMatch(/no longer exists/)
  })
})
