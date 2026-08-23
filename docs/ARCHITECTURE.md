# Architecture

Threadbox is an Electron application split into four trust boundaries.

## Renderer

React renders the grouped hierarchical task table, filters, settings, and confirmation dialogs. Desktop tasks with a `projectId` are grouped by that stable identifier, VS Code/CLI tasks are grouped by their recorded working directory, and projectless App Server tasks are grouped as independent work. Spawned tasks inherit their parent's group and fold under their parent row; matching descendant searches reveal their parent chain. The renderer has no Node.js access and cannot invoke arbitrary IPC channels. It receives normalized `ThreadRecord` objects and bounded stale-catalog summaries rather than raw protocol messages or database access.

## Preload

The sandboxed preload exposes a small typed API through `contextBridge`: environment status, thread listing and mutations, an explicit desktop Recents repair command, working-directory opening, executable selection, and settings.

## Main process

The main process validates IPC arguments, owns local settings, opens known working directories, discovers Codex CLI, starts App Server, and performs explicitly requested working-directory cleanup through the operating system Trash. It also owns the narrowly scoped desktop Recents catalog repairer. A renderer cannot supply a command line, database path, SQL, thread catalog host, arbitrary path, or trash a directory that is not attached to a selected deletable task.

## App Server integration

`AppServerClient` owns one newline-delimited JSON-RPC connection. It performs `initialize`, sends `initialized`, routes responses by numeric ID, ignores unrelated notifications, applies request timeouts, rejects pending calls when the process exits, and can restart cleanly.

`ThreadService` pages through active and archived `thread/list` results using all source kinds. It preserves each thread's `projectId`, normalizes the display model, derives the parent/child graph, and executes mutations sequentially. Project display names are derived from recorded task directories because the 0.149.0 production API does not expose a stable project-name listing method.

Permanent deletion refreshes inventory first. Running and pinned tasks are skipped. If both a parent and descendant are selected, only the parent is submitted because App Server deletion cascades to descendants.

Working-directory cleanup is opt-in per directory and runs only after its owning task is deleted. The main process rejects shared, root, home, Codex data, system, application-containing, symbolic-link, and missing paths. It uses Electron's Trash integration and never falls back to recursive permanent deletion.

## Desktop Recents catalog

Codex desktop maintains a derived sidebar catalog in `~/.codex/sqlite/codex-dev.db`. Because App Server notifications are process-local, a deletion made by Threadbox can remove the task and rollout without reaching the already-created desktop catalog row. `DesktopRecentsRepair` reads only visible `host_id = 'local'` catalog entries, compares their IDs with a freshly paged App Server inventory, and reports entries with no task record.

Repair is explicit and limited to those orphaned rows. Before a transaction, Threadbox uses SQLite's online backup API and verifies the result with `PRAGMA integrity_check`. The write statement is fixed in application code, targets exact thread IDs, ignores cloud hosts and already-hidden candidates, and increments the catalog revision. Backup or schema validation failure aborts the repair. Task state databases and JSONL rollouts are never edited.

## Compatibility

The v0.1 baseline is Codex CLI `0.149.0`. Generated TypeScript protocol files are committed under `src/shared/protocol/generated`. Unknown response fields are tolerated at runtime.

Features added after the baseline, currently pin metadata and mutation, are runtime capability-gated. Threadbox does not emulate missing task APIs through direct state-file edits; the desktop Recents exception applies only to its disposable derived sidebar catalog.

## Local data

Threadbox stores only:

- interface language;
- optional custom Codex executable path.

It does not persist thread data or conversation content. App settings live in Electron's platform-specific application data directory.

When Recents repair is used, timestamped backups of the derived desktop catalog are stored under `~/.codex/backups_threadbox/desktop-recents` for manual recovery.
