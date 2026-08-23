import { lstat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, parse, relative, resolve } from 'node:path'
import type {
  WorkingDirectoryCleanupResult,
  WorkingDirectoryIssue
} from '../../../src/shared/contracts'

export interface WorkingDirectoryCleanerLike {
  cleanup(paths: string[]): Promise<WorkingDirectoryCleanupResult>
}

interface DirectoryGroup {
  root: string
  paths: string[]
}

function pathKey(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? normalized.toLocaleLowerCase()
    : normalized
}

export function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

export function containsPath(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  if (samePath(normalizedParent, normalizedChild)) return true
  const childRelative = relative(normalizedParent, normalizedChild)
  return (
    childRelative.length > 0 &&
    childRelative !== '..' &&
    !childRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(childRelative)
  )
}

function uniquePaths(paths: string[]): string[] {
  const unique = new Map<string, string>()
  for (const path of paths) {
    if (!isAbsolute(path)) continue
    const normalized = resolve(path)
    unique.set(pathKey(normalized), normalized)
  }
  return [...unique.values()]
}

function groupNestedPaths(paths: string[]): DirectoryGroup[] {
  const groups: DirectoryGroup[] = []
  for (const path of uniquePaths(paths).toSorted((left, right) => left.length - right.length)) {
    const parent = groups.find((group) => containsPath(group.root, path))
    if (parent) parent.paths.push(path)
    else groups.push({ root: path, paths: [path] })
  }
  return groups
}

function issues(paths: string[], message: string): WorkingDirectoryIssue[] {
  return paths.map((path) => ({ path, message }))
}

export class WorkingDirectoryCleaner implements WorkingDirectoryCleanerLike {
  constructor(
    private readonly trashItem: (path: string) => Promise<void>,
    private readonly protectedPaths: string[]
  ) {}

  async cleanup(paths: string[]): Promise<WorkingDirectoryCleanupResult> {
    const requested = uniquePaths(paths)
    const trashed: string[] = []
    const failed: WorkingDirectoryIssue[] = []
    const skipped: WorkingDirectoryIssue[] = []

    for (const group of groupNestedPaths(requested)) {
      const unsafeReason = await this.unsafeReason(group.root)
      if (unsafeReason) {
        skipped.push(...issues(group.paths, unsafeReason))
        continue
      }

      try {
        await this.trashItem(group.root)
        trashed.push(...group.paths)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failed.push(...issues(group.paths, `Could not move the directory to Trash: ${message}`))
      }
    }

    return { requested, trashed, failed, skipped }
  }

  private async unsafeReason(path: string): Promise<string | null> {
    if (!isAbsolute(path)) return 'The working directory is not an absolute path.'
    if (samePath(path, parse(path).root)) return 'Filesystem roots cannot be moved to Trash.'
    if (samePath(path, homedir())) return 'The user home directory cannot be moved to Trash.'
    if (this.protectedPaths.some((protectedPath) => containsPath(path, protectedPath))) {
      return 'This directory contains the running Threadbox application or its current process directory.'
    }

    try {
      const stats = await lstat(path)
      if (stats.isSymbolicLink()) return 'Symbolic links and junctions are kept for safety.'
      if (!stats.isDirectory()) return 'The working directory path is not a directory.'
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      return code === 'ENOENT'
        ? 'The working directory no longer exists.'
        : 'The working directory could not be inspected safely.'
    }
    return null
  }
}
