import type { ThreadboxApi } from '../../../src/shared/contracts'

export type RpcMethod = keyof ThreadboxApi

export interface RpcRequest {
  kind: 'threadbox.request'
  id: string
  method: RpcMethod
  args: unknown[]
}

export interface RpcResponse {
  kind: 'threadbox.response'
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

const METHODS = new Set<RpcMethod>([
  'getPlatformCapabilities',
  'getEnvironmentStatus',
  'listThreads',
  'deleteThreads',
  'repairDesktopRecents',
  'archiveThreads',
  'unarchiveThreads',
  'setPinned',
  'listProjects',
  'createProject',
  'renameProject',
  'deleteProject',
  'assignThreads',
  'openWorkingDirectory',
  'copyThreadId',
  'chooseCliPath',
  'getSettings',
  'updateSettings'
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown, maximum = 32_768): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10_000 &&
    value.every((item) => isString(item, 512))
}

function validArgs(method: RpcMethod, args: unknown[]): boolean {
  if (['getPlatformCapabilities', 'getEnvironmentStatus', 'listThreads', 'repairDesktopRecents',
    'chooseCliPath', 'getSettings', 'listProjects'].includes(method)) return args.length === 0
  if (['archiveThreads', 'unarchiveThreads'].includes(method)) return args.length === 1 && isIds(args[0])
  if (method === 'setPinned') {
    return args.length === 2 && isIds(args[0]) && typeof args[1] === 'boolean'
  }
  if (method === 'createProject') {
    return args.length === 1 && isString(args[0], 80) && args[0].trim().length > 0
  }
  if (method === 'renameProject') {
    return args.length === 2 && isString(args[0], 128) && isString(args[1], 80) &&
      args[1].trim().length > 0
  }
  if (method === 'deleteProject') {
    return args.length === 1 && isString(args[0], 128)
  }
  if (method === 'assignThreads') {
    return args.length === 2 && isIds(args[0]) &&
      (args[1] === null || isString(args[1], 128))
  }
  if (method === 'deleteThreads') {
    return args.length === 2 && isIds(args[0]) && isObject(args[1]) &&
      Array.isArray(args[1].trashWorkingDirectories) && args[1].trashWorkingDirectories.length === 0
  }
  if (method === 'openWorkingDirectory' || method === 'copyThreadId') {
    return args.length === 1 && isString(args[0])
  }
  if (method === 'updateSettings') {
    if (args.length !== 1 || !isObject(args[0])) return false
    const keys = Object.keys(args[0])
    return keys.every((key) => key === 'locale' || key === 'customCliPath') &&
      (args[0].locale === undefined || args[0].locale === 'en' || args[0].locale === 'zh-CN') &&
      (args[0].customCliPath === undefined || args[0].customCliPath === null ||
        (typeof args[0].customCliPath === 'string' && args[0].customCliPath.length <= 4096))
  }
  return false
}

export function parseRpcRequest(value: unknown): RpcRequest | null {
  if (!isObject(value) || value.kind !== 'threadbox.request' || !isString(value.id, 128) ||
    typeof value.method !== 'string' || !METHODS.has(value.method as RpcMethod) ||
    !Array.isArray(value.args)) return null
  const method = value.method as RpcMethod
  return validArgs(method, value.args) ? {
    kind: 'threadbox.request',
    id: value.id,
    method,
    args: value.args
  } : null
}
