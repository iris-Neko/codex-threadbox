# Changelog

All notable changes to this project are documented here.

## VS Code 0.4.0 - 2026-08-24

- Add host-local Threadbox projects with create, rename, delete, assignment, official-project fallback, and root-task inheritance.
- Replace the summary-only Activity Bar view with a project tree supporting drag-and-drop, multi-select, archive, pin, delete, copy-ID, and open-directory actions.
- Add project, directory, and flat views plus project filtering and batch assignment to the full manager.
- Split VS Code extension releases from the desktop and npm CLI release pipeline.

## 0.3.0 - 2026-08-23

### Added

- Publish the Node.js `codex-threadbox` package with the `threadbox` command for SSH and headless hosts.
- Add interactive task search, grouping, spawned-task folding, multi-selection, archive, pin, and protected permanent deletion to the CLI.
- Add explicit script commands and stable `schemaVersion: 1` JSON output with fixed exit codes.
- Add the `irisNeko.threadbox-for-codex` workspace extension for local and Remote SSH, Dev Container, and Codespaces hosts.
- Reuse the complete React manager in a strict-CSP VS Code Webview with request IDs, timeouts, argument validation, and workspace-trust enforcement.
- Extract App Server, runtime, task service, filters, and UI into private shared workspace packages.
- Verify the packed npm CLI on Windows, macOS, and Linux and install/start the packaged VSIX in Extension Test.

### Changed

- Release one cross-platform npm CLI package rather than platform-specific standalone binaries.
- Hide desktop-only directory Trash and Recents repair features in CLI and VS Code.
- Terminate owned App Server process trees reliably during shutdown and ignore late exits from replaced processes.

## 0.2.0 - 2026-08-23

### Added

- Choose working directories individually when permanently deleting tasks.
- Move selected directories to the operating system Trash only after task deletion succeeds.
- Keep shared, root, home, Codex data, system, application-containing, symbolic-link, and missing paths.
- Report directory cleanup results separately from task deletion results.
- Display spawned tasks as expandable nested rows under their parent tasks.
- Group desktop Project tasks by `projectId`, VS Code/CLI tasks by working directory, and projectless desktop tasks separately.
- Switch between grouped and flat views and filter directly by project or workspace.
- Detect orphaned entries in Codex desktop's derived Recents catalog.
- Back up, verify, and repair stale local Recents index rows after explicit confirmation.
- Remove matching Recents index rows automatically after a successful App Server deletion.

### Fixed

- Selecting a parent task now automatically includes and locks all descendants, while submitting only the highest selected task for cascading operations.
- Replace the incorrect restart guidance with direct detection and repair of persisted Recents catalog rows.

## 0.1.1 - 2026-08-23

### Fixed

- Resolve Windows native executables and npm command shims explicitly when discovering Codex CLI.
- Continue to later PATH candidates when an earlier Codex launcher is stale or invalid.
- Wait for version-probe output streams to close before parsing the CLI version.
- Exercise real PATH-based CLI discovery in packaged application smoke tests.

## 0.1.0 - 2026-08-23

### Added

- Cross-platform Electron desktop application for Codex task history.
- Unified active and archived task list across working directories.
- Search, filters, sorting, batch selection, archive, unarchive, and permanent deletion.
- Parent/descendant awareness and protected destructive operations.
- Codex CLI discovery, minimum-version validation, and custom executable setting.
- English and Simplified Chinese interfaces with system light/dark themes.
- Isolated unit, integration, and Electron end-to-end tests.
- Windows, macOS, and Linux release workflows.
