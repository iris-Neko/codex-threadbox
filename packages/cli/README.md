# codex-threadbox

Headless CLI for [Threadbox for Codex](https://github.com/iris-Neko/codex-threadbox).

```bash
npx codex-threadbox
npm install -g codex-threadbox
threadbox list
threadbox list --include-spawned
threadbox delete --dry-run THREAD_ID
threadbox delete --yes THREAD_ID
```

Run `threadbox` in a TTY for the interactive manager. Script commands are `status`, `list`, `archive`, `unarchive`, `pin`, `unpin`, and `delete`. Internal spawned tasks are hidden unless `list --include-spawned` is used. `delete --dry-run` reports the final roots, cascaded descendants, and protected tasks without deleting anything. Use `--json` for the stable `schemaVersion: 1` contract. Non-interactive permanent deletion requires `--yes`.

Requires Node.js 22.13 or newer and Codex CLI 0.149.0 or newer. Configuration priority is command options, `CODEX_BINARY` / `CODEX_HOME`, then system defaults.

The CLI uses only Codex App Server task APIs. It does not read full conversation content, delete working directories, repair Codex desktop's Recents catalog, call a model, upload data, or collect telemetry.
