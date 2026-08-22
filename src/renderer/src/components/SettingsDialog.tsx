import { FolderSearch, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppLocale, AppSettings, EnvironmentStatus } from '../../../shared/contracts'
import { Modal } from './Modal'

interface SettingsDialogProps {
  settings: AppSettings
  environment: EnvironmentStatus
  busy: boolean
  onClose(): void
  onSave(settings: AppSettings): void
  onBrowse(): Promise<string | null>
}

export function SettingsDialog({
  settings,
  environment,
  busy,
  onClose,
  onSave,
  onBrowse
}: SettingsDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [locale, setLocale] = useState<AppLocale>(settings.locale)
  const [customCliPath, setCustomCliPath] = useState(settings.customCliPath ?? '')

  return (
    <Modal
      title={t('settings')}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="button button--secondary" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => onSave({ locale, customCliPath: customCliPath.trim() || null })}
          >
            {t('save')}
          </button>
        </>
      }
    >
      <div className="settings-form">
        <label className="field">
          <span className="field__label">{t('language')}</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value as AppLocale)}>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>

        <div className="field">
          <span className="field__label">{t('cliPath')}</span>
          <div className="path-input-row">
            <input
              value={customCliPath}
              onChange={(event) => setCustomCliPath(event.target.value)}
              placeholder="codex"
              spellCheck={false}
            />
            <button
              className="button button--secondary button--icon-text"
              type="button"
              onClick={() => void onBrowse().then((path) => path && setCustomCliPath(path))}
            >
              <FolderSearch size={16} aria-hidden="true" />
              {t('browse')}
            </button>
            <button
              className="icon-button"
              type="button"
              title={t('resetPath')}
              aria-label={t('resetPath')}
              onClick={() => setCustomCliPath('')}
            >
              <RotateCcw size={17} aria-hidden="true" />
            </button>
          </div>
          <span className="field__hint">{t('cliPathHint')}</span>
        </div>

        <dl className="environment-details">
          <div>
            <dt>{t('version')}</dt>
            <dd>{environment.cliVersion ?? '-'}</dd>
          </div>
          <div>
            <dt>{t('capability')}</dt>
            <dd>
              {environment.capabilities.pinning ? t('available') : t('unavailable')}
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  )
}
