export const CODEX_PRIMARY_CONTAINER = 'codexViewContainer'
export const CODEX_SECONDARY_CONTAINER = 'codexSecondaryViewContainer'

const KNOWN_CODEX_CONTAINERS = [
  CODEX_PRIMARY_CONTAINER,
  CODEX_SECONDARY_CONTAINER
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function findKnownCodexViewContainers(packageJson: unknown): string[] {
  if (!isRecord(packageJson) || !isRecord(packageJson.contributes)) return []
  const containers = packageJson.contributes.viewsContainers
  if (!isRecord(containers)) return []

  const contributedIds = new Set<string>()
  for (const value of Object.values(containers)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (isRecord(item) && typeof item.id === 'string') contributedIds.add(item.id)
    }
  }
  return KNOWN_CODEX_CONTAINERS.filter((id) => contributedIds.has(id))
}
