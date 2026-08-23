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
