import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppLocale, AppSettings } from '../shared/contracts'

const DEFAULT_SETTINGS: AppSettings = {
  locale: 'en',
  customCliPath: null
}

function normalizeLocale(value: unknown): AppLocale {
  return value === 'zh-CN' ? 'zh-CN' : 'en'
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 4096 ? trimmed : null
}

export class SettingsStore {
  private settings: AppSettings | null = null
  private readonly filePath = join(app.getPath('userData'), 'settings.json')

  async load(): Promise<AppSettings> {
    if (this.settings) return { ...this.settings }

    let persisted: Partial<AppSettings> = {}
    try {
      persisted = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<AppSettings>
    } catch {
      // Missing or invalid settings fall back to local defaults.
    }

    const systemLocale = app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
    this.settings = {
      ...DEFAULT_SETTINGS,
      locale: normalizeLocale(persisted.locale ?? systemLocale),
      customCliPath: normalizePath(persisted.customCliPath)
    }
    return { ...this.settings }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.load()
    this.settings = {
      locale: patch.locale === undefined ? current.locale : normalizeLocale(patch.locale),
      customCliPath:
        patch.customCliPath === undefined ? current.customCliPath : normalizePath(patch.customCliPath)
    }

    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
    return { ...this.settings }
  }
}
