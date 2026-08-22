# Architecture

Threadbox is an Electron application split into four trust boundaries.

## Renderer

React renders the task table, filters, settings, and confirmation dialogs. It has no Node.js access and cannot invoke arbitrary IPC channels. The renderer receives normalized `ThreadRecord` objects rather than raw protocol messages.

## Preload

The sandboxed preload exposes a small typed API through `contextBridge`: environment status, thread listing and mutations, working-directory opening, executable selection, and settings.

## Main process

The main process validates IPC arguments, owns local settings, opens known working directories, discovers Codex CLI, and starts App Server. A renderer cannot supply a command line or open an arbitrary path.

## App Server integration

`AppServerClient` owns one newline-delimited JSON-RPC connection. It performs `initialize`, sends `initialized`, routes responses by numeric ID, ignores unrelated notifications, applies request timeouts, rejects pending calls when the process exits, and can restart cleanly.

`ThreadService` pages through active and archived `thread/list` results using all source kinds. It normalizes the display model, derives the parent/child graph, hides internal tasks by default, and executes mutations sequentially.

Permanent deletion refreshes inventory first. Running and pinned tasks are skipped. If both a parent and descendant are selected, only the parent is submitted because App Server deletion cascades to descendants.

## Compatibility

The v0.1 baseline is Codex CLI `0.149.0`. Generated TypeScript protocol files are committed under `src/shared/protocol/generated`. Unknown response fields are tolerated at runtime.

Features added after the baseline, currently pin metadata and mutation, are runtime capability-gated. Threadbox does not emulate missing App Server features through direct state-file edits.

## Local data

Threadbox stores only:

- interface language;
- optional custom Codex executable path.

It does not persist thread data or conversation content. App settings live in Electron's platform-specific application data directory.
