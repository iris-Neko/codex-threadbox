import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './Modal'

interface ProjectDialogProps {
  initialName?: string
  busy: boolean
  onClose(): void
  onSubmit(name: string): void
}

export function ProjectDialog({
  initialName = '',
  busy,
  onClose,
  onSubmit
}: ProjectDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.select(), [])

  const valid = name.trim().length > 0 && name.trim().length <= 80
  return (
    <Modal
      title={initialName ? t('renameProject') : t('newProject')}
      onClose={onClose}
      footer={(
        <>
          <button className="button button--secondary" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button
            className="button button--primary"
            type="submit"
            form="project-form"
            disabled={busy || !valid}
          >
            {initialName ? t('rename') : t('createProject')}
          </button>
        </>
      )}
    >
      <form
        id="project-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) onSubmit(name.trim())
        }}
      >
        <label className="field">
          <span>{t('projectName')}</span>
          <input
            ref={input}
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}
