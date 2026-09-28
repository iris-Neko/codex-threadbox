const vscode = require('vscode')
const fs = require('node:fs/promises')
exports.activate = (context) => {
  context.subscriptions.push(vscode.commands.registerCommand('claude-vscode.editor.open', async (...args) => {
    if (!process.env.THREADBOX_TEST_CLAUDE_LOG) throw new Error('Missing isolated Claude test log')
    await fs.appendFile(process.env.THREADBOX_TEST_CLAUDE_LOG, JSON.stringify(args) + '\n')
  }))
}
