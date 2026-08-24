import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FolderKanban,
  FolderOpen,
  MessageSquare,
  Pencil,
  Pin,
  Trash2
} from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectRecord, ThreadRecord } from '../../../../src/shared/contracts'
import { formatTimestamp, type ThreadRowGroup, type ThreadTreeRow } from '../thread-utils'

interface ThreadTableProps {
  rows: ThreadTreeRow[]
  groups: ThreadRowGroup[] | null
  collapsedGroups: Set<string>
  forceGroupsExpanded: boolean
  selected: Set<string>
  implicitlySelected: Set<string>
  locale: string
  allSelectableSelected: boolean
  someSelectableSelected: boolean
  allowOpenDirectory: boolean
  allowActiveSelection: boolean
  onToggle(id: string): void
  onToggleVisible(): void
  onToggleExpanded(id: string, currentlyExpanded: boolean): void
  onToggleGroup(id: string): void
  onOpenDirectory(path: string): void
  onCopyId(id: string): void
  onArchive(thread: ThreadRecord): void
  onDelete(thread: ThreadRecord): void
  onRenameProject(project: ProjectRecord): void
  onDeleteProject(project: ProjectRecord): void
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
  rows,
  groups,
  collapsedGroups,
  forceGroupsExpanded,
  selected,
  implicitlySelected,
  locale,
  allSelectableSelected,
  someSelectableSelected,
  allowOpenDirectory,
  allowActiveSelection,
  onToggle,
  onToggleVisible,
  onToggleExpanded,
  onToggleGroup,
  onOpenDirectory,
  onCopyId,
  onArchive,
  onDelete,
  onRenameProject,
  onDeleteProject
}: ThreadTableProps): React.JSX.Element {
  const { t } = useTranslation()
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelectableSelected && !allSelectableSelected
    }
  }, [allSelectableSelected, someSelectableSelected])

  const renderRow = ({ thread, depth, hasChildren, expanded, matchesFilter }: ThreadTreeRow) => {
    const automaticallyIncluded = implicitlySelected.has(thread.id)
    const disabled = (!allowActiveSelection && thread.status === 'active') || !matchesFilter
    const mutationDisabled = thread.status === 'active' || !matchesFilter || automaticallyIncluded
    const rowClassName = [
      selected.has(thread.id) ? 'is-selected' : null,
      automaticallyIncluded ? 'thread-row--auto-selected' : null,
      depth > 0 ? 'thread-row--child' : null,
      !matchesFilter ? 'thread-row--context' : null
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <tr key={thread.id} className={rowClassName || undefined}>
        <td className="check-cell">
          <span title={automaticallyIncluded ? t('includedByParentHint') : undefined}>
            <input
              type="checkbox"
              checked={selected.has(thread.id)}
              disabled={disabled || automaticallyIncluded}
              title={
                automaticallyIncluded
                  ? t('includedByParentHint')
                  : !matchesFilter
                    ? t('contextCannotSelect')
                    : thread.status === 'active'
                      ? t('activeCannotSelect')
                      : undefined
              }
              aria-label={`${t('thread')}: ${thread.title}`}
              onChange={() => onToggle(thread.id)}
            />
          </span>
        </td>
        <td>
          <div className="thread-cell" style={{ paddingLeft: `${Math.min(depth, 6) * 18}px` }}>
            {hasChildren ? (
              <button
                className="tree-toggle"
                type="button"
                aria-expanded={expanded}
                aria-label={t(expanded ? 'collapseSpawned' : 'expandSpawned', {
                  title: thread.title
                })}
                title={t(expanded ? 'collapseSpawned' : 'expandSpawned', {
                  title: thread.title
                })}
                onClick={() => onToggleExpanded(thread.id, expanded)}
              >
                {expanded ? (
                  <ChevronDown size={16} aria-hidden="true" />
                ) : (
                  <ChevronRight size={16} aria-hidden="true" />
                )}
              </button>
            ) : (
              <span className="tree-spacer" aria-hidden="true" />
            )}
            <div className="thread-cell__body">
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
              {automaticallyIncluded && (
                <span className="thread-meta thread-meta--included">{t('includedByParent')}</span>
              )}
            </div>
          </div>
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
            {allowOpenDirectory && <button
              className="icon-button icon-button--small"
              type="button"
              title={t('openDirectory')}
              aria-label={t('openDirectory')}
              onClick={() => onOpenDirectory(thread.cwd)}
            >
              <FolderOpen size={16} aria-hidden="true" />
            </button>}
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
              disabled={mutationDisabled}
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
              title={
                automaticallyIncluded
                  ? t('includedByParentHint')
                  : thread.pinned
                    ? t('pinnedCannotDelete')
                    : t('deleteHint')
              }
              aria-label={t('delete')}
              disabled={mutationDisabled || thread.pinned}
              onClick={() => onDelete(thread)}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const renderGroupHeader = (group: ThreadRowGroup): React.JSX.Element => {
    const collapsed = !forceGroupsExpanded && collapsedGroups.has(group.id)
    const title = group.kind === 'standalone' ? t('standaloneTasks') : group.name
    const kindLabel =
      group.kind === 'threadboxProject'
        ? t('threadboxProject')
        : group.kind === 'desktopProject'
        ? t('desktopProject')
        : group.kind === 'standalone'
          ? t('standaloneGroup')
          : group.sources.length === 1 && group.sources[0] === 'vscode'
            ? t('vscodeWorkspace')
            : group.sources.length === 1 && group.sources[0] === 'cli'
              ? t('cliWorkspace')
              : t('localWorkspace')
    const detail =
      group.kind === 'standalone'
        ? t('standaloneGroupHint')
        : group.directories.length === 1
          ? group.directories[0]
          : t('groupDirectoryCount', { count: group.directories.length })
    const GroupIcon =
      group.kind === 'threadboxProject' || group.kind === 'desktopProject'
        ? FolderKanban
        : group.kind === 'standalone'
          ? MessageSquare
          : Code2

    return (
      <tr className="thread-group-row">
        <td colSpan={7}>
          <div className="thread-group-header">
            <button
              className="thread-group-toggle"
              type="button"
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? 'expandGroup' : 'collapseGroup', { title })}
              onClick={() => onToggleGroup(group.id)}
            >
              {collapsed ? (
                <ChevronRight size={17} aria-hidden="true" />
              ) : (
                <ChevronDown size={17} aria-hidden="true" />
              )}
              <span className="thread-group-icon" aria-hidden="true">
                <GroupIcon size={16} />
              </span>
              <span className="thread-group-body">
                <span className="thread-group-line">
                  <strong>{title}</strong>
                  <span className="thread-group-kind">{kindLabel}</span>
                </span>
                <span className="thread-group-detail" title={detail}>{detail}</span>
              </span>
              <span className="thread-group-count">
                {t('groupTaskCount', { count: group.taskCount })}
                {group.spawnedCount > 0 && ` · ${t('spawnedTaskCount', { count: group.spawnedCount })}`}
              </span>
            </button>
            {group.kind === 'threadboxProject' && group.project && (
              <div className="thread-group-actions">
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  title={t('renameProject')}
                  aria-label={t('renameProject')}
                  onClick={() => onRenameProject(group.project!)}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  className="icon-button icon-button--small icon-button--danger"
                  type="button"
                  title={t('deleteProject')}
                  aria-label={t('deleteProject')}
                  onClick={() => onDeleteProject(group.project!)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
    )
  }

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
          {groups
            ? groups.map((group) => {
                const collapsed = !forceGroupsExpanded && collapsedGroups.has(group.id)
                return (
                  <Fragment key={group.id}>
                    {renderGroupHeader(group)}
                    {!collapsed && group.rows.map(renderRow)}
                  </Fragment>
                )
              })
            : rows.map(renderRow)}
        </tbody>
      </table>
    </div>
  )
}
