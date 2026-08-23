export function requireWorkspaceTrust(isTrusted: boolean): void {
  if (!isTrusted) {
    throw new Error('Trust this workspace before Threadbox starts Codex or changes task metadata.')
  }
}
