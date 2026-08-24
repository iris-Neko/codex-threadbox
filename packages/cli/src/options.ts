import type { AppLocale } from '../../../src/shared/contracts'

export function parseLanguage(value: string): AppLocale {
  if (value === 'en' || value === 'zh-CN') return value
  throw new Error('Language must be one of: en, zh-CN.')
}

export function resolveLanguage(value?: string): AppLocale {
  if (value) return parseLanguage(value)
  return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en'
}
