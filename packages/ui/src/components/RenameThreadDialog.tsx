import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeThreadName } from '../../../../src/shared/thread-name'
import { Modal } from './Modal'

interface RenameThreadDialogProps {
  initialName: string
  busy: boolean
  onClose(): void
  onSubmit(name: string): Promise<void>
}

export function RenameThreadDialog({ initialName, busy, onClose, onSubmit }: RenameThreadDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  let normalized: string | null = null
  try { normalized = normalizeThreadName(name) } catch { /* Invalid input disables submission. */ }
  const close = (): void => { if (!busy && !submitting.current) onClose() }
  return (
    <Modal title={t('renameThread')} onClose={close} footer={(
      <>
        <button className="button button--secondary" type="button" onClick={close} disabled={busy}>{t('cancel')}</button>
        <button className="button button--primary" type="submit" form="rename-thread-form"
          disabled={busy || normalized === null || normalized === initialName}>{t('rename')}</button>
      </>
    )}>
      <form id="rename-thread-form" onSubmit={(event) => {
        event.preventDefault()
        if (busy || submitting.current || normalized === null || normalized === initialName) return
        submitting.current = true
        setError(null)
        void onSubmit(normalized).catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : t('operationFailed'))
        }).finally(() => { submitting.current = false })
      }}>
        <label className="field">
          <span>{t('threadName')}</span>
          <input ref={input} value={name} maxLength={512} disabled={busy}
            aria-invalid={normalized === null} onChange={(event) => { setName(event.target.value); setError(null) }} />
        </label>
        {normalized === null && <p role="alert">{t('invalidThreadName')}</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
