import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectRecord } from '../../../../src/shared/contracts'
import { Modal } from './Modal'

interface CreateThreadDialogProps {
  project: ProjectRecord
  busy: boolean
  onClose(): void
  onSubmit(name: string): void
}

export function CreateThreadDialog({
  project,
  busy,
  onClose,
  onSubmit
}: CreateThreadDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  const normalized = name.trim()
  const valid = normalized.length > 0 && normalized.length <= 512 &&
    [...normalized].every((character) => character.charCodeAt(0) >= 32)
  return (
    <Modal
      title={t('newThreadInProject', { name: project.name })}
      onClose={onClose}
      footer={(
        <>
          <button className="button button--secondary" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            className="button button--primary"
            type="submit"
            form="create-thread-form"
            disabled={busy || !valid}
          >
            {t('createThread')}
          </button>
        </>
      )}
    >
      <form
        id="create-thread-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) onSubmit(normalized)
        }}
      >
        <label className="field">
          <span>{t('threadName')}</span>
          <input
            ref={input}
            value={name}
            maxLength={512}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
