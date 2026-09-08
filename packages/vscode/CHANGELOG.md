# Changelog

## 1.0.0 - 2026-09-08

First 1.0 release of the VS Code extension. This release promotes the existing sidebar workflow without changing the project or Trash storage format.

- Native sidebar only, with host-local projects, workspace import, search, filters, sorting, and metadata tooltips.
- Create blank tasks in projects, rename active tasks, and open them in the official Codex view.
- Optional checkbox mode alongside native Ctrl/Shift selection; batch actions through right-click menus and drag-and-drop.
- Archived tasks grouped by original directory beside Unassigned; a separate recoverable Trash with explicit permanent deletion.
- Workspace trust checks, task-family confirmations, running/pinned deletion protection where exposed by Codex, and detailed failure feedback.
- Linux writer-lock recovery with process identity checks and separate confirmation before force termination.
- Codex CLI install/update guidance on the extension host.

Compatibility: Codex CLI 0.153.3 and 0.153.4 are the supported stable validation pair; older versions must be upgraded. Existing projects and Trash records are preserved. Desktop 0.3.0 and Threadbox CLI 0.3.1 are unchanged.

Known boundaries: Codex interface project definitions cannot be synchronized through the public App Server. Archived tasks must be restored before renaming with the supported CLI versions. Automatic writer recovery is Linux-only and requires Python 3.9+ with pidfd support. No conversation bodies, model calls, telemetry, or working-directory deletion are added.
