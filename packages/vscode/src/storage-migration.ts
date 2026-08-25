import { constants } from 'node:fs'
import { access, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const PROJECT_FILE = 'projects-v1.json'
const LEGACY_EXTENSION_IDS = [
  'irisneko.threadbox-for-codex',
  'iris-neko.threadbox-for-codex'
]

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function migrateLegacyProjectStorage(currentDirectory: string): Promise<boolean> {
  const target = join(currentDirectory, PROJECT_FILE)
  if (await exists(target)) return false

  const globalStorage = dirname(currentDirectory)
  for (const extensionId of LEGACY_EXTENSION_IDS) {
    const source = join(globalStorage, extensionId, PROJECT_FILE)
    if (!await exists(source)) continue
    await mkdir(currentDirectory, { recursive: true })
    try {
      await copyFile(source, target, constants.COPYFILE_EXCL)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    }
  }
  return false
}
