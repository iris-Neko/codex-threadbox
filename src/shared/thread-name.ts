export function normalizeThreadName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159)
  })) {
    throw new Error('Task names must contain 1-512 visible characters.')
  }
  const name = value.trim()
  if (!name || name.length > 512) throw new Error('Task names must contain 1-512 visible characters.')
  return name
}

export function validThreadId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
}
