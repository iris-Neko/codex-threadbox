# Threadbox Repository Guide

## Product lanes

Threadbox is one monorepo with three independently versioned products. Keep work
for each product in its own task and avoid changing another product's version or
release workflow unless the request explicitly requires it.

| Product | Current version | Primary paths | Release tag |
| --- | --- | --- | --- |
| Desktop | `0.3.0` | `src/`, Electron configuration, desktop packaging | `v<version>` |
| CLI | `0.3.1` | `packages/cli/` | `cli-v<version>` |
| VS Code | `0.4.1` | `packages/vscode/` | `vscode-v<version>` |

The desktop version comes from the root `package.json`. The CLI and VS Code
versions come only from their own package manifests. Do not synchronize these
versions merely because shared code changed.

## Shared ownership

- `packages/core/` owns Codex CLI discovery, App Server transport, pagination,
  normalized task records, filtering, parent-child relationships, and protected
  batch operations.
- `packages/ui/` owns the host-neutral React manager and the typed
  `ThreadboxApi` contract.
- `src/shared/` owns cross-host contracts and committed generated protocol
  types.
- `tests/` and `tests/fixtures/` contain shared regression coverage and fake
  App Server fixtures.
- `scripts/` contains repository-wide smoke tests and generation utilities.

Treat changes under shared paths as three-product changes. Identify every host
affected, preserve capability gating, and run the full shared verification
suite. Prefer a host adapter over adding Electron, terminal, or VS Code details
to shared packages.

## Host boundaries

### Desktop

- Keep the renderer sandboxed, context-isolated, and without Node access.
- Expose functionality only through the typed preload API and validated IPC.
- Directory Trash and desktop Recents repair are desktop-only capabilities.
- Recents repair may touch only the derived desktop catalog, after creating and
  validating a backup. It must never repair rollout files or task state.

### CLI

- Support Node.js `>=22.13.0`; do not add a bundled Node executable.
- Keep `--json` stable under `schemaVersion: 1`, free of ANSI and progress UI.
- Mutating commands accept explicit task IDs. Non-interactive deletion requires
  `--yes`; dry runs must have no side effects.
- The CLI never deletes working directories and does not expose desktop Recents
  repair.

### VS Code

- Keep `extensionKind: ["workspace"]` so remote hosts manage their own tasks.
- Do not start Codex or mutate tasks in an untrusted workspace.
- Keep Webviews under a strict CSP with local assets, no Node access, a fixed RPC
  allowlist, request IDs, timeouts, and runtime argument validation.
- Threadbox projects contain only names and root task IDs in
  `globalStorageUri`. They are manual, host-local assignments and must not alter
  official Codex project data.
- The sidebar is the primary workflow. Preserve spawned-task folding and open
  tasks in the official Codex view when that integration is available.

## Data and deletion safety

- Use only the official Codex App Server for task state. Do not directly edit
  Codex task databases, JSONL rollouts, or project files.
- Do not read, render, persist, or upload full conversation bodies. Threadbox
  manages metadata only and has no telemetry or model calls.
- Before permanent deletion, refresh inventory, exclude running or pinned
  tasks, collapse selected descendants under selected parents, and continue
  safely after individual failures.
- Tests must use the fake stdio server or an isolated temporary `CODEX_HOME`.
  Never list, archive, pin, or delete the developer's real tasks from tests.
- Unknown fields from newer App Server versions must remain parseable. The
  minimum supported Codex CLI version is `0.149.0` until deliberately changed.

## Working rules

- Start by reading the relevant package manifest, architecture section, tests,
  and host adapter. Follow existing patterns before introducing abstractions.
- Keep edits scoped. Do not commit `node_modules/`, build output, test results,
  credentials, tokens, or user-specific Codex data.
- Generated protocol changes must be produced with `npm run protocol:generate`
  and reviewed for unexpected churn.
- Add focused tests for behavior changes. Shared contracts or core changes need
  regression coverage for all affected hosts.
- Do not overwrite unrelated working-tree changes. Use focused commits and make
  product ownership clear in commit subjects when useful, for example
  `fix(cli): ...` or `feat(vscode): ...`.

## Verification

Install with `npm ci`. The repository baseline is:

```text
npm run lint
npm run typecheck
npm test
```

Then run the lane-specific checks:

```text
# Desktop
npm run build
npm run test:e2e

# CLI
npm run test:cli
npm run test:cli-package
npm run test:integration

# VS Code
npm run build:vscode
npm run test:vscode
npm run package:vscode
```

Scale verification to the change, but run the baseline plus every affected lane
before a release. Real-CLI integration must always use isolated data.

## Release rules

- Desktop releases use `.github/workflows/release.yml` and `v<version>` tags.
- CLI releases use `.github/workflows/release-cli.yml` and
  `cli-v<version>` tags.
- VS Code releases use `.github/workflows/release-vscode.yml` and
  `vscode-v<version>` tags.
- Verify the tag against the owning manifest before tagging. Do not reuse or
  move a published tag.
- Keep GitHub releases as drafts until their required downstream publication
  succeeds. A failed npm or extension-marketplace publish must remain visible
  and must not be silently skipped.
- Never print release tokens. Store them only in the appropriate GitHub Actions
  secrets and use stdin or the provider's secure input path when rotating them.
