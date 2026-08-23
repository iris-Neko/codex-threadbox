import { AlertTriangle, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRecord } from '../../../../src/shared/contracts'
import { deletableThreads } from '../thread-utils'
import { Modal } from './Modal'

interface DeleteDialogProps {
  threads: ThreadRecord[]
  externalProcesses: number
  busy: boolean
  allowDirectoryTrash: boolean
  onClose(): void
  onConfirm(ids: string[], trashWorkingDirectories: string[]): void
}

export function DeleteDialog({
  threads,
  externalProcesses,
  busy,
  allowDirectoryTrash,
  onClose,
  onConfirm
}: DeleteDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)
  const [trashDirectories, setTrashDirectories] = useState<Set<string>>(new Set())
  const eligible = useMemo(() => deletableThreads(threads), [threads])
  const directories = useMemo(
    () => [...new Set(eligible.map((thread) => thread.cwd))].toSorted(),
    [eligible]
  )
  const protectedCount = threads.length - eligible.length
  const descendantCount = eligible.reduce((total, thread) => total + thread.descendantCount, 0)

  const toggleDirectory = (path: string): void => {
    setAcknowledged(false)
    setTrashDirectories((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

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
            onClick={() =>
              onConfirm(
                eligible.map((thread) => thread.id),
                [...trashDirectories]
              )
            }
          >
            <Trash2 size={16} aria-hidden="true" />
            {busy
              ? t('operationRunning')
              : t(trashDirectories.size > 0 ? 'confirmDeleteWithDirectories' : 'confirmDelete')}
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
      {allowDirectoryTrash && <fieldset className="directory-cleanup">
        <legend>{t('directoryCleanupTitle')}</legend>
        <p>{t('directoryCleanupHint')}</p>
        <div className="directory-cleanup__list">
          {directories.map((path) => (
            <label key={path} className="directory-cleanup__option">
              <input
                type="checkbox"
                checked={trashDirectories.has(path)}
                onChange={() => toggleDirectory(path)}
                disabled={busy}
              />
              <span>{path}</span>
            </label>
          ))}
        </div>
        {trashDirectories.size > 0 && (
          <p className="directory-cleanup__selection">
            {t('directoryCleanupSelected', { count: trashDirectories.size })}
          </p>
        )}
      </fieldset>}
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
        <span>
          {t(
            trashDirectories.size > 0 ? 'deleteAcknowledgeWithDirectories' : 'deleteAcknowledge'
          )}
        </span>
      </label>
    </Modal>
  )
}
