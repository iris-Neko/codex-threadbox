# Contributing

Thanks for helping improve Threadbox for Codex.

## Setup

1. Install Node.js 22 or newer and npm.
2. Run `npm install`.
3. Run `npm run dev` for the desktop app, `npm run build:cli` for the CLI, or `npm run build:vscode` for the extension.

Codex is a user runtime dependency, not an application dependency. The exact `@openai/codex` version in `devDependencies` exists only for protocol generation and isolated integration checks.

## Before opening a pull request

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:cli
npm run test:cli-package
npm run test:vscode
npm run test:integration
npm run test:e2e
npm run package
```

Do not edit `src/shared/protocol/generated` by hand. Update the pinned Codex development dependency, run `npm run protocol:generate`, and include the resulting protocol diff.

Any change to permanent deletion, archive state, process detection, CLI discovery, or IPC must include focused tests. Tests must use an isolated `CODEX_HOME` or the fake App Server fixtures and must never mutate a contributor's real Codex state.

## Project boundaries

- Keep host filesystem and process access in Electron main, the CLI host, or the VS Code extension host.
- Keep Electron and Webview renderers sandboxed and expose only typed, purpose-specific bridges.
- Use App Server APIs for task mutations. Do not add SQLite or rollout-file mutation fallbacks.
- Never add working-directory deletion or desktop Recents access to the CLI or VS Code host.
- Do not log task titles, previews, paths, IDs, or conversation content.
- Keep English and Simplified Chinese strings in sync.

By contributing, you agree that your contribution is licensed under the MIT License.
