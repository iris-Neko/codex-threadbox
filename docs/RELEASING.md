# Releasing

The historical `v0.3.0` release contained desktop installers, `codex-threadbox-0.3.0.tgz`, one cross-platform VSIX, and `SHA256SUMS.txt`. Desktop/CLI `v<semver>` tags now start `.github/workflows/release.yml`; that workflow no longer publishes the extension marketplaces.

VS Code-only releases use `vscode-v<version>` tags and `.github/workflows/release-vscode.yml`. For example, `vscode-v0.4.0` packages and publishes only `threadbox-for-codex-0.4.0.vsix`; desktop and npm CLI versions remain unchanged.

The workflow builds and tests everything before creating a draft GitHub Release. It then publishes npm, VS Code Marketplace, and Open VSX in sequence. GitHub remains a draft unless all three registries succeed.

## Account-owner checkpoints

The account owner must complete actions that cannot be delegated safely:

1. Sign in to npm, accept current terms and 2FA requirements, and authorize a granular automation token that can publish the new unscoped `codex-threadbox` package.
2. Create or confirm the VS Code Marketplace publisher `irisNeko`, accept publisher agreements, and authorize a Marketplace `Manage` token.
3. Sign in to Open VSX, create or claim the `irisNeko` namespace, accept its publisher agreement, and authorize a publishing token.

After the user completes those checkpoints, the release operator writes the resulting values to repository Actions secrets named `NPM_TOKEN`, `VSCE_PAT`, and `OVSX_PAT`. Do not put tokens in files, issues, logs, commits, or command arguments.

Before tagging, verify `npm view codex-threadbox` still returns not found, all repository secrets are present, CI is green on `main`, and package versions are `0.3.0`. Create and push `v0.3.0` only after those checks.

For a VS Code-only release, verify the extension manifest version matches the tag, `VSCE_PAT` and `OVSX_PAT` are available (or manually publish Marketplace before rerunning without `VSCE_PAT`), and CI is green. The GitHub Release remains a draft until both Marketplace and Open VSX contain the new version.
