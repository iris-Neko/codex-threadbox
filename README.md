# Threadbox for Codex

**A local, cross-platform desktop manager for Codex tasks.**

[简体中文](README.zh-CN.md)

![Threadbox task list](docs/images/threadbox-main.png)

Threadbox brings Codex CLI and desktop task history from every working directory into one searchable list. It uses the official [Codex App Server](https://learn.chatgpt.com/docs/app-server) for thread operations and never edits Codex SQLite databases or JSONL rollouts directly.

> Threadbox for Codex is an independent community project. It is not affiliated with or endorsed by OpenAI.

## Features

- List active and archived tasks across all working directories.
- Search titles, previews, paths, sources, and task IDs.
- Filter by archive state, source, directory, and recent activity.
- Archive, unarchive, and permanently delete one or many tasks.
- Detect parent/child task relationships and avoid duplicate cascade deletion requests.
- Protect running tasks and require an explicit irreversible-deletion acknowledgement.
- Warn when other Codex processes may make cross-process running status incomplete.
- Open the original working directory or copy a task ID.
- Hide internal sub-agent tasks by default.
- English and Simplified Chinese interface with system light/dark themes.

Everything runs locally. Threadbox has no telemetry, does not call a model, and does not upload or retain conversation content.

## Requirements

- Windows 10/11, macOS, or a modern Linux desktop.
- Codex CLI `0.149.0` or newer available on `PATH`.

Install or update Codex CLI:

```bash
npm install -g @openai/codex@latest
```

You can also select a custom Codex executable in Threadbox settings or set `CODEX_BINARY`.

## Install

Download the package for your platform from [GitHub Releases](https://github.com/iris-Neko/codex-threadbox/releases).

- **Windows:** run the NSIS installer or unpack the ZIP build. The unsigned v0.1 build may trigger SmartScreen; inspect the publisher and release checksum before choosing **More info > Run anyway**.
- **macOS:** open the DMG or ZIP build. The unsigned v0.1 build may require right-clicking the app and choosing **Open**, or approving it in **System Settings > Privacy & Security**.
- **Linux:** install the DEB package or mark the AppImage executable and launch it.

Every release includes `SHA256SUMS.txt`.

## Safety model

Permanent deletion calls App Server `thread/delete`, which also deletes spawned descendants. Threadbox refreshes the inventory immediately before deletion, removes active or pinned tasks from the request, collapses selected descendants under selected parents, and executes root deletions sequentially so one failure does not stop the rest.

Codex `0.149.0` does not yet expose pin metadata in its stable App Server schema. Threadbox keeps pin controls capability-gated and enables them only when the installed stable CLI advertises the required API. It never works around a missing API by modifying Codex state files.

Runtime status belongs to an App Server process. A separate Threadbox process cannot guarantee that it sees work running inside another Codex desktop or IDE process, so Threadbox displays an additional warning whenever other Codex processes are detected.

## Development

Prerequisites: Node.js 22+ (Node.js 24 is used in CI) and npm.

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run package
```

The integration test creates an isolated temporary `CODEX_HOME`. Unit and Electron tests use a fake stdio App Server. Tests never mutate real Codex tasks.

Regenerate protocol types from the pinned Codex development dependency:

```bash
npm run protocol:generate
```

See [Architecture](docs/ARCHITECTURE.md) and [Contributing](CONTRIBUTING.md) for project details.

## Scope

v0.1 intentionally excludes full transcript viewing/export, backup restoration, direct database repair, automatic CLI upgrades, and a bundled Codex CLI.

## License

[MIT](LICENSE)
