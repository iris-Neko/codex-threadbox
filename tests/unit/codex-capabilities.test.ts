// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pinningFromSchemas } from '../../packages/core/src/codex-capabilities'

const list = { type: 'object', properties: { limit: { type: 'integer' } } }
const update = { type: 'object', properties: { threadId: { type: 'string' } } }

describe('Codex pinning capability schemas', () => {
  it('recognizes explicitly unsupported APIs without assuming a minimum version', () => {
    expect(pinningFromSchemas(list, update)).toBe(false)
  })
  it('requires boolean pinning parameters on both APIs', () => {
    expect(pinningFromSchemas(
      { ...list, properties: { ...list.properties, isPinned: { type: ['boolean', 'null'] } } },
      { ...update, properties: { ...update.properties, isPinned: { type: 'boolean' } } }
    )).toBe(true)
  })
  it.each([null, {}, { type: 'object', properties: {} }])('fails closed for malformed schemas', (bad) => {
    expect(() => pinningFromSchemas(bad, update)).toThrow(/unrecognized/)
    expect(() => pinningFromSchemas(list, bad)).toThrow(/unrecognized/)
  })
  it('fails closed for incomplete support', () => {
    expect(() => pinningFromSchemas(list, {
      ...update, properties: { ...update.properties, isPinned: { type: 'boolean' } }
    })).toThrow(/incomplete/)
  })
})
