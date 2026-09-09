# Architecture

Threadbox is an npm workspace with shared core and UI packages plus three host adapters.

## Shared core

`@threadbox/core` owns Codex CLI discovery, minimum-version checks, the newline-delimited JSON-RPC App Server client, pagination, normalized task records, parent/descendant relationships, filtering, and protected sequential batch operations. It accepts an injected client descriptor and environment so the desktop app, CLI, and VS Code extension identify themselves and use the correct host's `CODEX_BINARY` and `CODEX_HOME`.

`AppServerClient` performs `initialize`, sends `initialized`, routes responses by numeric ID, ignores unrelated notifications, applies timeouts, rejects pending requests on exit, and reconnects on the next request. Shutdown terminates the owned App Server process tree, including npm command shims on Windows.

`ThreadService` pages through active and archived `thread/list` results using all source kinds. It preserves `projectId`, derives the parent/child graph, and accepts unknown protocol response fields. It never reads full conversation turns.

## Shared UI

`@threadbox/ui` is the React task manager. It receives an injected typed `ThreadboxApi`; it has no Electron, VS Code, filesystem, or Node dependency. `PlatformCapabilities` hides host-only controls such as desktop Recents repair, directory Trash, native executable selection, and current-workspace filtering.

Desktop Project tasks are grouped by `projectId`, and projectless tasks fall back to working-directory groups. VS Code can overlay a Threadbox-owned project assignment on a root task without changing its official `projectId`; removing the overlay restores the official or directory group. Spawned tasks fold under their parent row and inherit their root task's Threadbox project.

## Desktop host

Desktop 1.0 uses its own renderer composition: project/directory navigation and a
root-task list, with secondary filters in a disclosure. Projects and directories
are separate sidebar sections: projects group by official project ID and expand
to main-task shortcuts, while directory filters group all main tasks by working
path. Projectless desktop tasks retain an independent-tasks entry. Spawned agents are not
independently displayed or selected. Unlinked internal tasks have a separate
cleanup scope. Selection counts represent visible tasks; delete confirmation
includes descendants. A running or pinned descendant blocks its parent's delete
action, and the service rechecks protection against refreshed inventory. Pin and
archive actions target explicitly selected tasks only. Shared UI dialogs remain
reused, without changing the VS Code manager or CLI behavior.

`DesktopProjects` reads the paginated official `project/list` endpoint with an
explicit desktop-only experimental API opt-in. CLI and VS Code retain their
default handshake. On older servers, the desktop adapter supports a read-only
fallback to the local project catalog in `.codex-global-state.json`. During an
incomplete desktop project migration, it uses only explicit local project
assignments, scoped to this `CODEX_HOME` and excluding projectless tasks. Canonical
thread project IDs take precedence. Names never come from working-directory
guesses, and empty projects remain visible. The adapter returns only project
metadata and membership; it never writes or migrates official project data,
reads conversation bodies, or changes task state. Retrieval failures are shown
separately from an empty project list.

The Flatpak desktop build injects a host-process launcher into the core runtime.
It invokes `flatpak-spawn --host --watch-bus` with literal argument arrays and an
explicit `CODEX_HOME`; only the static login-shell trampoline is shell code.
Native desktop, CLI, and VS Code retain the default launcher. Flatpak ships no
Codex binary and requests host filesystem and host-command access explicitly.

Electron runs the renderer with sandboxing, context isolation, and no Node integration. A preload exposes only the typed API over fixed IPC channels. The main process validates IDs and known paths, stores language and optional CLI path settings, starts App Server, opens working directories, and owns two desktop-only adapters:

- selected working-directory cleanup through the operating system Trash;
- repair of orphaned rows in Codex desktop's derived Recents catalog.

The renderer cannot supply SQL, arbitrary IPC channels, catalog hosts, or directories unrelated to selected tasks.

## CLI host

The `codex-threadbox` npm package installs the `threadbox` command and requires Node.js 22.13 or newer. It supports a prompt-based interactive manager and explicit script commands. Internal spawned tasks are hidden by default, and deletion preview uses the same refreshed protection and parent-child resolution as permanent deletion. `--json` uses a stable `schemaVersion: 1` envelope and never emits ANSI or progress animation.

The CLI accepts task IDs only for mutations. It does not contain the desktop Recents or directory Trash adapters and has no parameter, including a hidden one, that recursively deletes a working directory.

## VS Code host

The extension declares `extensionKind: ["workspace"]`, so Remote SSH, Dev Containers, and Codespaces run the extension, Codex CLI, App Server, and `CODEX_HOME` on the remote host. Its Activity Bar tree provides in-memory metadata search and manual project assignment; it opens the shared UI in an editor Webview for the full manager.

The Webview has a strict nonce CSP, bundled local resources, no Node access, request IDs, timeouts, a fixed method allowlist, and per-method argument validation. The extension rechecks workspace trust before any Codex probe, task listing, mutation, or folder-open request. Machine-scoped settings configure the remote CLI path, Codex home, and language.

Project names and root-task assignments use a versioned JSON file under the remote extension host's `globalStorageUri`. Writes use temporary-file replacement; corrupt files are preserved with a timestamped suffix before an empty catalog is created. The data is isolated per extension host, contains no transcript content, and is not synchronized between servers.

## Deletion safety

Permanent deletion refreshes inventory first. Running and pinned tasks are skipped. If a parent and descendant are selected, only the highest selected parent is submitted because App Server deletion cascades. Requests run sequentially, and one failure does not stop the remaining tasks.

Only the desktop adapter can move explicitly checked `cwd` values to Trash, and only after the owning task deletion succeeds. Roots, home, Codex data, system locations, application-containing paths, symbolic links, missing paths, and directories referenced by remaining tasks are preserved. Trash failure never falls back to permanent filesystem deletion.

## Desktop Recents catalog

Codex desktop maintains a derived sidebar catalog in `~/.codex/sqlite/codex-dev.db`. App Server deletion from another process can leave an orphaned catalog row. `DesktopRecentsRepair` compares visible local-host rows with a fresh App Server inventory.

Repair is explicit. It first creates an SQLite online backup under `~/.codex/backups_threadbox/desktop-recents` and verifies it with `PRAGMA integrity_check`. Fixed statements target exact orphan IDs, ignore cloud hosts, and do not alter task state databases, JSONL rollouts, or project files.

## Compatibility and local data

Codex CLI `0.149.0` is the v0.3 minimum baseline. Generated TypeScript protocol files are committed under `src/shared/protocol/generated`; capabilities added after the baseline are gated at runtime.

Threadbox has no telemetry and persists no task or conversation copy. Desktop stores interface language and optional CLI path. VS Code uses machine-scoped settings plus its host-local project names and task-ID assignments. The CLI stores no Threadbox settings.
