// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { parseRpcRequest } from '../../packages/vscode/src/rpc'
import { requireWorkspaceTrust } from '../../packages/vscode/src/workspace-trust'

describe('VS Code Webview RPC validation', () => {
  it('accepts allowlisted methods with valid parameters', () => {
    expect(parseRpcRequest({
      kind: 'threadbox.request',
      id: 'request-1',
      method: 'deleteThreads',
      args: [['thread-1'], { trashWorkingDirectories: [] }]
    })).toMatchObject({ method: 'deleteThreads' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-2', method: 'assignThreads',
      args: [['thread-1'], 'threadbox:project-1']
    })).toMatchObject({ method: 'assignThreads' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-3', method: 'createProject', args: ['Focus']
    })).toMatchObject({ method: 'createProject' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-import', method: 'importCurrentWorkspaceProject',
      args: []
    })).toMatchObject({ method: 'importCurrentWorkspaceProject' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-4', method: 'createThreadInProject',
      args: ['threadbox:one', 'New task']
    })).toMatchObject({ method: 'createThreadInProject' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-trash', method: 'trashThreads',
      args: [['thread-1']]
    })).toMatchObject({ method: 'trashThreads' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-restore', method: 'restoreThreadsFromTrash',
      args: [['thread-1']]
    })).toMatchObject({ method: 'restoreThreadsFromTrash' })
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: 'request-empty', method: 'emptyTrash', args: []
    })).toMatchObject({ method: 'emptyTrash' })
  })

  it('rejects unknown methods and host-only directory deletion', () => {
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '1', method: 'runShell', args: []
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request',
      id: '2',
      method: 'deleteThreads',
      args: [['thread-1'], { trashWorkingDirectories: ['/workspace'] }]
    })).toBeNull()
  })

  it('rejects malformed settings and oversized IDs', () => {
    expect(parseRpcRequest({
      kind: 'threadbox.request',
      id: '3',
      method: 'updateSettings',
      args: [{ locale: 'fr', unexpected: true }]
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '5', method: 'createProject', args: [' '.repeat(10)]
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '6', method: 'assignThreads', args: [['thread-1'], 42]
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '7', method: 'createThreadInProject',
      args: ['threadbox:one', '   ']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '8', method: 'createThreadInProject',
      args: ['threadbox:one', 'bad\nname']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '9', method: 'createThreadInProject',
      args: ['official:\ninvalid', 'New task']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '9b', method: 'createThreadInProject',
      args: ['official:one', 'New task']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '10', method: 'importCurrentWorkspaceProject',
      args: [['/client/supplied/path']]
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '13', method: 'createOfficialProject', args: ['Hidden']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '11', method: 'emptyTrash', args: ['unexpected']
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request', id: '12', method: 'restoreThreadsFromTrash', args: [[]]
    })).toBeNull()
    expect(parseRpcRequest({
      kind: 'threadbox.request',
      id: '4',
      method: 'archiveThreads',
      args: [['x'.repeat(513)]]
    })).toBeNull()
  })

  it('blocks Codex startup and mutations in an untrusted workspace', () => {
    expect(() => requireWorkspaceTrust(false)).toThrow(/Trust this workspace/)
    expect(() => requireWorkspaceTrust(true)).not.toThrow()
  })
})
