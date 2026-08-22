# Changelog

All notable changes to this project are documented here.

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
