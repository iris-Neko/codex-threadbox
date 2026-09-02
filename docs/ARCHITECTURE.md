# Architecture

Threadbox is an npm workspace with shared core and UI packages plus three host adapters.

## Shared core

`@threadbox/core` owns Codex CLI discovery, minimum-version checks, the newline-delimited JSON-RPC App Server client, pagination, normalized task records, parent/descendant relationships, filtering, and protected sequential batch operations. It accepts an injected client descriptor and environment so the desktop app, CLI, and VS Code extension identify themselves and use the correct host's `CODEX_BINARY` and `CODEX_HOME`.

`AppServerClient` performs `initialize`, sends `initialized`, routes responses by numeric ID, ignores unrelated notifications, applies timeouts, rejects pending requests on exit, and reconnects on the next request. Shutdown terminates the owned App Server process tree, including npm command shims on Windows.

`ThreadService` pages through active and archived `thread/list` results using all source kinds. It preserves `projectId`, derives the parent/child graph, and accepts unknown protocol response fields. It never reads full conversation turns.

## Shared UI

`@threadbox/ui` is the React task manager. It receives an injected typed `ThreadboxApi`; it has no Electron, VS Code, filesystem, or Node dependency. `PlatformCapabilities` hides host-only controls such as desktop Recents repair, directory Trash, VS Code task Trash, native executable selection, and current-workspace filtering.

Desktop Project tasks are grouped by `projectId`, and projectless tasks fall back to working-directory groups. VS Code overlays a Threadbox-owned project assignment on a root task without changing its protocol `projectId`; host-owned project IDs that have no Threadbox record fall back to working-directory groups. Spawned tasks fold under their parent row and inherit their root task's Threadbox project.

## Desktop host

Electron runs the renderer with sandboxing, context isolation, and no Node integration. A preload exposes only the typed API over fixed IPC channels. The main process validates IDs and known paths, stores language and optional CLI path settings, starts App Server, opens working directories, and owns two desktop-only adapters:

- selected working-directory cleanup through the operating system Trash;
- repair of orphaned rows in Codex desktop's derived Recents catalog.

The renderer cannot supply SQL, arbitrary IPC channels, catalog hosts, or directories unrelated to selected tasks.

## CLI host

The `codex-threadbox` npm package installs the `threadbox` command and requires Node.js 22.13 or newer. It supports a prompt-based interactive manager and explicit script commands. Internal spawned tasks are hidden by default, and deletion preview uses the same refreshed protection and parent-child resolution as permanent deletion. `--json` uses a stable `schemaVersion: 1` envelope and never emits ANSI or progress animation.

The CLI accepts task IDs only for mutations. It does not contain the desktop Recents or directory Trash adapters and has no parameter, including a hidden one, that recursively deletes a working directory.

## VS Code host

The extension declares `extensionKind: ["workspace"]`, so Remote SSH, Dev Containers, and Codespaces run the extension, Codex CLI, App Server, and `CODEX_HOME` on the remote host. Its Activity Bar tree provides in-memory metadata search, current-workspace import, and manual project assignment; it opens the shared UI in an editor Webview for the full manager.

The Webview has a strict nonce CSP, bundled local resources, no Node access, request IDs, timeouts, a fixed method allowlist, and per-method argument validation. The extension rechecks workspace trust before any Codex probe, CLI install or update, task listing, mutation, or folder-open request. Machine-scoped settings configure the remote CLI path, Codex home, and language. A zero-argument host RPC either executes the detected outdated CLI with the official `update` subcommand or, when Codex is missing, runs the platform's fixed official standalone installer for an explicit user-level target. The target executable must report the minimum version before its path is stored and App Server reconnects. The Webview cannot supply a command, executable path, installer URL, or arguments.

An npm `EACCES` or `EPERM` update failure is handled separately from other failures. On Unix extension hosts, Threadbox offers a fixed `sudo npm install -g @openai/codex` command in a visible remote integrated terminal so the existing system installation can remain the only installation. The alternative standalone migration uses a non-privileged user directory and then prompts to remove the old system npm copy with a fixed sudo uninstall command. Threadbox never captures sudo input or silently removes a shared system installation. Exact user-level path selection keeps Threadbox deterministic while cleanup is pending; it does not introduce multi-candidate version preference in shared CLI discovery.

Project names and root-task assignments use a versioned JSON file under the remote extension host's `globalStorageUri`. Workspace import matches root-task working directories against every open workspace folder and writes project creation plus all assignments in one temporary-file replacement; cancellation and empty matches do not write. Corrupt files are preserved with a timestamped suffix before an empty catalog is created. The data is isolated per extension host, contains no transcript content, and is not synchronized between servers.

The same host-local project file contains a built-in Trash assignment and the previous Threadbox project ID for each trashed root task. A legacy project named `trash` is promoted in place. Moving a task to Trash first applies the normal refreshed running/pinned protection, archives it through App Server, and then writes the local assignment. Restore unarchives the task and returns it to the recorded Threadbox project when it still exists. Either operation rolls back the App Server state if the local write fails. Empty Trash permanently deletes only the roots currently assigned to Trash, using the shared protected deletion path, and never deletes working directories.

Codex interface projects are not currently exposed by the public App Server, so the VS Code host does not issue `project/*` requests or present those definitions as manageable projects. Tasks carrying an unknown host-owned `projectId` remain usable, are grouped by working directory, and still open in Codex. Creating a blank task in a Threadbox project uses `thread/start({ cwd })`, then `thread/name/set`, verifies the stored metadata with `thread/read`, and finally stores the local root-task assignment; a verification, naming, or assignment failure deletes the new empty task. App Server omits tasks without a first turn from `thread/list`, so the VS Code adapter rehydrates assigned blank tasks by ID with `thread/read` without loading conversation turns.

## Deletion safety

Permanent deletion refreshes inventory first. Running and pinned tasks are skipped. If a parent and descendant are selected, only the highest selected parent is submitted because App Server deletion cascades. Requests run sequentially, and one failure does not stop the remaining tasks. In VS Code, ordinary deletion first moves tasks into the archive-backed built-in Trash; permanent deletion is available only through Empty Trash.

Only the desktop adapter can move explicitly checked `cwd` values to Trash, and only after the owning task deletion succeeds. Roots, home, Codex data, system locations, application-containing paths, symbolic links, missing paths, and directories referenced by remaining tasks are preserved. Trash failure never falls back to permanent filesystem deletion.

## Desktop Recents catalog

Codex desktop maintains a derived sidebar catalog in `~/.codex/sqlite/codex-dev.db`. App Server deletion from another process can leave an orphaned catalog row. `DesktopRecentsRepair` compares visible local-host rows with a fresh App Server inventory.

Repair is explicit. It first creates an SQLite online backup under `~/.codex/backups_threadbox/desktop-recents` and verifies it with `PRAGMA integrity_check`. Fixed statements target exact orphan IDs, ignore cloud hosts, and do not alter task state databases, JSONL rollouts, or project files.

## Compatibility and local data

Codex CLI `0.150.0` is the minimum supported runtime. Release validation covers the two latest stable versions, `0.150.0` and `0.150.1`; `0.149.x` and older are rejected. Generated TypeScript protocol files are committed under `src/shared/protocol/generated` from Codex CLI `0.150.1`; newer unknown response fields remain parseable and optional capabilities are gated at runtime.

Threadbox has no telemetry and persists no task or conversation copy. Desktop stores interface language and optional CLI path. VS Code uses machine-scoped settings plus its host-local project names and task-ID assignments. The CLI stores no Threadbox settings.
