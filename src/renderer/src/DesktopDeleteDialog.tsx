import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadRecord } from '../../shared/contracts'
import { Modal } from '../../../packages/ui/src/components/Modal'

export function DesktopDeleteDialog({ threads, externalProcesses, busy, onClose, onConfirm }: {
  threads: ThreadRecord[]
  externalProcesses: number
  busy: boolean
  allowDirectoryTrash: boolean
  onClose(): void
  onConfirm(ids: string[], directories: string[]): void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const text = (en: string, cn: string): string => i18n.language.startsWith('zh') ? cn : en
  const [acknowledged, setAcknowledged] = useState(false)
  const [directories, setDirectories] = useState<Set<string>>(new Set())
  const descendants = threads.reduce((count, thread) => count + thread.descendantCount, 0)
  return <Modal title={t('deleteTitle')} destructive onClose={busy ? () => undefined : onClose} footer={<>
    <button className="button button--secondary" disabled={busy} onClick={onClose}>{t('cancel')}</button>
    <button className="button button--danger" disabled={busy || !acknowledged || !threads.length} onClick={() => onConfirm(threads.map((thread) => thread.id), [...directories])}><Trash2 size={16} />{busy ? t('operationRunning') : t(directories.size ? 'confirmDeleteWithDirectories' : 'confirmDelete')}</button>
  </>}>
    <p>{t('deleteBody')}</p>
    <ul className="desktop-delete-titles">{threads.map((thread) => <li key={thread.id}>{thread.title}</li>)}</ul>
    <dl className="impact-list"><div><dt>{t('deleteEligible', { count: threads.length })}</dt></div>{descendants > 0 && <div><dt>{text(`Includes ${descendants} child ${descendants === 1 ? 'task' : 'tasks'}, deleted together with the parent.`, `包含 ${descendants} 个子任务，将随主任务一起删除。`)}</dt></div>}</dl>
    {externalProcesses > 0 && <p className="inline-warning">{t('deleteExternalWarning')}</p>}
    <details className="desktop-directory-options"><summary>{text('Also move working folders to Trash', '同时将工作目录移入回收站')}</summary><p>{t('directoryCleanupHint')}</p>{[...new Set(threads.map((thread) => thread.cwd))].map((path) => <label key={path} className="directory-cleanup__option"><input type="checkbox" disabled={busy} checked={directories.has(path)} onChange={() => { setAcknowledged(false); setDirectories((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next }) }} /><span>{path}</span></label>)}</details>
    {directories.size > 0 && <p className="inline-warning">{t('directoryCleanupSelected', { count: directories.size })}</p>}
    <label className="confirmation-check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{t(directories.size ? 'deleteAcknowledgeWithDirectories' : 'deleteAcknowledge')}</span></label>
  </Modal>
}
