import { AlertTriangle, DatabaseBackup, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopRecentsStatus } from '../../../../src/shared/contracts'
import { Modal } from './Modal'

interface RecentsRepairDialogProps {
  status: DesktopRecentsStatus
  busy: boolean
  onClose(): void
  onConfirm(): void
}

export function RecentsRepairDialog({
  status,
  busy,
  onClose,
  onConfirm
}: RecentsRepairDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <Modal
      title={t('recentsRepairTitle')}
      onClose={busy ? () => undefined : onClose}
      destructive
      footer={
        <>
          <button className="button button--secondary" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={!acknowledged || status.staleCount === 0 || busy}
            onClick={onConfirm}
          >
            <Wrench size={16} aria-hidden="true" />
            {busy ? t('operationRunning') : t('recentsRepairConfirm')}
          </button>
        </>
      }
    >
      <div className="danger-heading">
        <span className="danger-heading__icon">
          <AlertTriangle size={22} aria-hidden="true" />
        </span>
        <p>{t('recentsRepairBody', { count: status.staleCount })}</p>
      </div>

      <div className="backup-note">
        <DatabaseBackup size={17} aria-hidden="true" />
        <span>{t('recentsRepairBackup')}</span>
      </div>

      <div className="stale-entry-list" aria-label={t('recentsRepairEntries')}>
        {status.staleEntries.map((entry) => (
          <div className="stale-entry" key={entry.id}>
            <span>{entry.title}</span>
            <code>{entry.id}</code>
          </div>
        ))}
      </div>

      <label className="confirmation-check recents-confirmation">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={busy}
        />
        <span>{t('recentsRepairAcknowledge')}</span>
      </label>
    </Modal>
  )
}
