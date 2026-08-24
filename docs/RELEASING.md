# Releasing

Desktop, npm CLI, and VS Code releases are versioned independently.

- Desktop tags use `v<version>` and `.github/workflows/release.yml`.
- npm CLI tags use `cli-v<version>` and `.github/workflows/release-cli.yml`.
- VS Code tags use `vscode-v<version>` and `.github/workflows/release-vscode.yml`.

Each workflow verifies its tag against the matching package manifest. A desktop release contains only platform installers. A CLI release contains the npm `.tgz` and `SHA256SUMS.txt`. A VS Code release contains only the cross-platform VSIX and its checksum.

## Account-owner checkpoints

The account owner must complete actions that cannot be delegated safely:

1. Sign in to npm, accept current terms and 2FA requirements, and authorize a granular automation token that can publish the unscoped `codex-threadbox` package.
2. Create or confirm the VS Code Marketplace publisher `irisNeko`, accept publisher agreements, and authorize a Marketplace `Manage` token.
3. Sign in to Open VSX, create or claim the `irisNeko` namespace, accept its publisher agreement, and authorize a publishing token.

Repository Actions secrets are named `NPM_TOKEN`, `VSCE_PAT`, and `OVSX_PAT`. Never put tokens in files, issues, logs, commits, or command arguments.

## npm CLI release

Before tagging, verify CI is green, `packages/cli/package.json` contains the intended version, and that version is not already present on npm. Push `cli-v<version>` only after those checks.

The workflow tests the CLI on Windows, macOS, and Linux, installs the packed artifact, creates a draft GitHub Release, publishes npm with provenance, and verifies the installed registry package against the fake App Server. The GitHub Release remains a draft if npm publishing or verification fails.

## VS Code release

Verify the extension manifest version matches the tag and the Marketplace credentials are available. The workflow publishes the same VSIX to VS Code Marketplace and Open VSX. The GitHub Release remains a draft until both registries contain the new version.
