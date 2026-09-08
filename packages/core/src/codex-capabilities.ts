function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function properties(schema: unknown, requiredField: string): Record<string, unknown> {
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties) ||
    !object(schema.properties[requiredField])) {
    throw new Error('Codex returned an unrecognized task API schema.')
  }
  return schema.properties
}

function booleanField(value: unknown): boolean {
  if (!object(value)) return false
  return value.type === 'boolean' ||
    (Array.isArray(value.type) && value.type.includes('boolean')) ||
    (Array.isArray(value.anyOf) && value.anyOf.some(booleanField))
}

export function pinningFromSchemas(listSchema: unknown, updateSchema: unknown): boolean {
  const list = properties(listSchema, 'limit')
  const update = properties(updateSchema, 'threadId')
  if (!('isPinned' in list) && !('isPinned' in update)) return false
  if (booleanField(list.isPinned) && booleanField(update.isPinned)) return true
  // Do not interpret an incomplete or unfamiliar API as permission to delete pinned tasks.
  throw new Error('Codex exposes an incomplete or unrecognized pinning API.')
}
