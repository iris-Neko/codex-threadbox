// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { parseLanguage } from '../../packages/cli/src/options'
import { CLI_VERSION } from '../../packages/cli/src/version'

describe('CLI options', () => {
  it('accepts only supported languages', () => {
    expect(parseLanguage('en')).toBe('en')
    expect(parseLanguage('zh-CN')).toBe('zh-CN')
    expect(() => parseLanguage('fr')).toThrow(/Language must be/)
  })

  it('reads the version from the CLI package metadata', () => {
    expect(CLI_VERSION).toBe('0.3.1')
  })
})
