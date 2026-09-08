// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs'
import { expect, it } from 'vitest'
import { requireWorkspaceTrust } from '../../packages/vscode/src/workspace-trust'
const manifest = JSON.parse(readFileSync('packages/vscode/package.json', 'utf8'))
it('removes the Manager command, activation and Webview implementation', () => {
  expect(manifest.contributes.commands.some((c: { command: string }) => c.command === 'threadbox.openManager')).toBe(false)
  expect(manifest.activationEvents).not.toContain('onCommand:threadbox.openManager')
  expect(existsSync('packages/vscode/src/webview.tsx')).toBe(false)
  expect(existsSync('packages/vscode/src/rpc.ts')).toBe(false)
  const extension = readFileSync('packages/vscode/src/extension.ts', 'utf8')
  expect(extension).not.toMatch(/createWebviewPanel|onDidReceiveMessage|webviewHtml/)
  expect(existsSync('packages/ui/src/App.tsx')).toBe(true)
})
it('keeps only search, filters and refresh in the top toolbar', () => {
  const actions = manifest.contributes.menus['view/title'] as Array<{ command: string; group: string }>
  expect(actions.filter((c) => c.group.startsWith('navigation')).map((c) => c.command)).toEqual([
    'threadbox.searchSidebar', 'threadbox.filterSidebar', 'threadbox.refreshSidebar'
  ])
  expect(actions.some((c) => c.command === 'threadbox.openSettings')).toBe(true)
  expect(actions.some((c) => c.command === 'threadbox.selectFiltered')).toBe(true)
})
it('retains native workspace trust guards after removing Webview RPC', () => {
  expect(() => requireWorkspaceTrust(false)).toThrow()
  expect(() => requireWorkspaceTrust(true)).not.toThrow()
})
