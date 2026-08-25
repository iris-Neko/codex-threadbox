import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectKind } from '../../../../src/shared/contracts'
import { Modal } from './Modal'

interface ProjectDialogProps {
  initialName?: string
  initialKind?: ProjectKind
  allowOfficial: boolean
  busy: boolean
  onClose(): void
  onSubmit(name: string, kind: ProjectKind): void
}

export function ProjectDialog({
  initialName = '',
  initialKind,
  allowOfficial,
  busy,
  onClose,
  onSubmit
}: ProjectDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<ProjectKind>(initialKind ?? (allowOfficial ? 'official' : 'threadbox'))
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
          if (valid) onSubmit(name.trim(), kind)
        }}
      >
        {!initialName && allowOfficial && (
          <div className="field">
            <span>{t('projectType')}</span>
            <div className="segmented-control" role="group" aria-label={t('projectType')}>
              <button
                type="button"
                className={kind === 'official' ? 'is-active' : undefined}
                onClick={() => setKind('official')}
                disabled={busy}
              >
                {t('codexProject')}
              </button>
              <button
                type="button"
                className={kind === 'threadbox' ? 'is-active' : undefined}
                onClick={() => setKind('threadbox')}
                disabled={busy}
              >
                {t('threadboxProject')}
              </button>
            </div>
          </div>
        )}
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
