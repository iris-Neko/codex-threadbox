import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderOpen,
  Pin,
  Trash2
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRecord } from '../../../shared/contracts'
import { formatTimestamp } from '../thread-utils'

interface ThreadTableProps {
  threads: ThreadRecord[]
  selected: Set<string>
  locale: string
  allSelectableSelected: boolean
  someSelectableSelected: boolean
  onToggle(id: string): void
  onToggleVisible(): void
  onOpenDirectory(path: string): void
  onCopyId(id: string): void
  onArchive(thread: ThreadRecord): void
  onDelete(thread: ThreadRecord): void
}

function StateCell({ thread }: { thread: ThreadRecord }): React.JSX.Element {
  const { t } = useTranslation()
  const key =
    thread.status === 'active'
      ? 'statusActive'
      : thread.status === 'idle'
        ? 'statusIdle'
        : thread.status === 'systemError'
          ? 'statusError'
          : 'statusReady'

  return (
    <div className="state-stack">
      <span className={`state-label state-label--${thread.status}`}>
        <span className="state-dot" aria-hidden="true" />
        {t(key)}
      </span>
      {thread.pinned && (
        <span className="state-note">
          <Pin size={12} aria-hidden="true" />
          {t('statusPinned')}
        </span>
      )}
      {thread.archived && (
        <span className="state-note">
          <Archive size={12} aria-hidden="true" />
          {t('statusArchived')}
        </span>
      )}
    </div>
  )
}

export function ThreadTable({
  threads,
  selected,
  locale,
  allSelectableSelected,
  someSelectableSelected,
  onToggle,
  onToggleVisible,
  onOpenDirectory,
  onCopyId,
  onArchive,
  onDelete
}: ThreadTableProps): React.JSX.Element {
  const { t } = useTranslation()
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected && !allSelectableSelected
    }
  }, [allSelectableSelected, someSelectableSelected])

  return (
    <div className="table-scroll">
      <table className="thread-table">
        <colgroup>
          <col className="col-select" />
          <col className="col-thread" />
          <col className="col-directory" />
          <col className="col-updated" />
          <col className="col-state" />
          <col className="col-source" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th className="check-cell">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelectableSelected}
                onChange={onToggleVisible}
                aria-label={t('selectVisible')}
              />
            </th>
            <th>{t('thread')}</th>
            <th>{t('directory')}</th>
            <th>{t('updated')}</th>
            <th>{t('state')}</th>
            <th>{t('source')}</th>
            <th className="actions-heading">{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => {
            const disabled = thread.status === 'active'
            return (
              <tr key={thread.id} className={selected.has(thread.id) ? 'is-selected' : undefined}>
                <td className="check-cell">
                  <input
                    type="checkbox"
                    checked={selected.has(thread.id)}
                    disabled={disabled}
                    title={disabled ? t('activeCannotSelect') : undefined}
                    aria-label={`${t('thread')}: ${thread.title}`}
                    onChange={() => onToggle(thread.id)}
                  />
                </td>
                <td>
                  <div className="thread-title" title={thread.title}>
                    {thread.title}
                  </div>
                  <div className="thread-preview" title={thread.preview}>
                    {thread.preview || thread.id}
                  </div>
                  {thread.descendantCount > 0 && (
                    <span className="thread-meta">
                      {t('descendants', { count: thread.descendantCount })}
                    </span>
                  )}
                </td>
                <td>
                  <div className="path-cell" title={thread.cwd}>
                    {thread.cwd}
                  </div>
                </td>
                <td className="time-cell">{formatTimestamp(thread.updatedAt, locale)}</td>
                <td>
                  <StateCell thread={thread} />
                </td>
                <td>
                  <span className="source-label">{thread.source}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      title={t('openDirectory')}
                      aria-label={t('openDirectory')}
                      onClick={() => onOpenDirectory(thread.cwd)}
                    >
                      <FolderOpen size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      title={t('copyId')}
                      aria-label={t('copyId')}
                      onClick={() => onCopyId(thread.id)}
                    >
                      <Copy size={15} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      title={thread.archived ? t('unarchive') : t('archive')}
                      aria-label={thread.archived ? t('unarchive') : t('archive')}
                      disabled={disabled}
                      onClick={() => onArchive(thread)}
                    >
                      {thread.archived ? (
                        <ArchiveRestore size={16} aria-hidden="true" />
                      ) : (
                        <Archive size={16} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small icon-button--danger"
                      type="button"
                      title={thread.pinned ? t('pinnedCannotDelete') : t('delete')}
                      aria-label={t('delete')}
                      disabled={disabled || thread.pinned}
                      onClick={() => onDelete(thread)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
