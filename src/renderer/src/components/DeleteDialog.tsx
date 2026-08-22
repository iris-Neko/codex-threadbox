import { AlertTriangle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRecord } from '../../../shared/contracts'
import { deletableThreads } from '../thread-utils'
import { Modal } from './Modal'

interface DeleteDialogProps {
  threads: ThreadRecord[]
  externalProcesses: number
  busy: boolean
  onClose(): void
  onConfirm(ids: string[]): void
}

export function DeleteDialog({
  threads,
  externalProcesses,
  busy,
  onClose,
  onConfirm
}: DeleteDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)
  const eligible = useMemo(() => deletableThreads(threads), [threads])
  const protectedCount = threads.length - eligible.length
  const descendantCount = eligible.reduce((total, thread) => total + thread.descendantCount, 0)

  return (
    <Modal
      title={t('deleteTitle')}
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
            disabled={!acknowledged || eligible.length === 0 || busy}
            onClick={() => onConfirm(eligible.map((thread) => thread.id))}
          >
            <Trash2 size={16} aria-hidden="true" />
            {busy ? t('operationRunning') : t('confirmDelete')}
          </button>
        </>
      }
    >
      <div className="danger-heading">
        <span className="danger-heading__icon">
          <AlertTriangle size={22} aria-hidden="true" />
        </span>
        <p>{t('deleteBody')}</p>
      </div>
      <dl className="impact-list">
        <div>
          <dt>{t('deleteEligible', { count: eligible.length })}</dt>
        </div>
        {protectedCount > 0 && (
          <div>
            <dt>{t('deleteProtected', { count: protectedCount })}</dt>
          </div>
        )}
        {descendantCount > 0 && (
          <div>
            <dt>{t('deleteCascade', { count: descendantCount })}</dt>
          </div>
        )}
      </dl>
      {externalProcesses > 0 && (
        <div className="inline-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{t('deleteExternalWarning')}</span>
        </div>
      )}
      <label className="confirmation-check">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={busy}
        />
        <span>{t('deleteAcknowledge')}</span>
      </label>
    </Modal>
  )
}
