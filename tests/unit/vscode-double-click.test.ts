// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DoubleClickGate } from '../../packages/vscode/src/double-click'

describe('VS Code task double-click gate', () => {
  it('opens only after the same task is invoked twice within the delay', () => {
    let now = 1_000
    const gate = new DoubleClickGate(650, () => now)

    expect(gate.register('first')).toBe(false)
    now += 300
    expect(gate.register('first')).toBe(true)
    now += 100
    expect(gate.register('first')).toBe(false)
  })

  it('does not combine different tasks or expired clicks', () => {
    let now = 1_000
    const gate = new DoubleClickGate(650, () => now)

    expect(gate.register('first')).toBe(false)
    now += 200
    expect(gate.register('second')).toBe(false)
    now += 700
    expect(gate.register('second')).toBe(false)
  })
})
