import semver from 'semver'
import { CodexRuntime, type RuntimeProbe } from '../../core/src/codex-runtime'

export const VSCODE_MINIMUM_CODEX_VERSION = '0.157.0'

/** Keep this product's moving support floor out of Desktop and CLI behavior. */
export class VscodeCodexRuntime extends CodexRuntime {
  override async probe(force = false): Promise<RuntimeProbe> {
    const result = await super.probe(force)
    const outdated = result.status.cliVersion !== null &&
      semver.lt(result.status.cliVersion, VSCODE_MINIMUM_CODEX_VERSION)
    return {
      ...result,
      status: {
        ...result.status,
        minimumVersion: VSCODE_MINIMUM_CODEX_VERSION,
        ...(outdated ? {
          state: 'outdated' as const,
          message: `Codex CLI ${VSCODE_MINIMUM_CODEX_VERSION} or newer is required by Threadbox for VS Code.`
        } : {})
      }
    }
  }
}
