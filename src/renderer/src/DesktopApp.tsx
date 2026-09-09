import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, Copy, FolderOpen, Inbox, LoaderCircle, Pin, PinOff, RefreshCw, Search, Settings, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, BatchOperationResult, ListThreadsResult, ProjectSnapshot, ThreadboxApi, ThreadRecord } from '../../shared/contracts'
import { DEFAULT_FILTERS, filterThreads, formatTimestamp, resolveThreadSelection } from '../../../packages/core/src/thread-utils'
import { DesktopDeleteDialog as DeleteDialog } from './DesktopDeleteDialog'
import { SettingsDialog } from '../../../packages/ui/src/components/SettingsDialog'
import { RecentsRepairDialog } from '../../../packages/ui/src/components/RecentsRepairDialog'
import { desktopInventory, desktopDeletionBlocks, desktopNavigation } from './desktop-model'
import { DesktopNavigation } from './DesktopNavigation'
import packageJson from '../../../package.json'
import appIcon from '../../../resources/icon.png'
import './desktop.css'

export default function DesktopApp({ api }: { api: ThreadboxApi }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const text = (en: string, cn: string): string => i18n.language.startsWith('zh') ? cn : en
  const [snapshot, setSnapshot] = useState<ListThreadsResult | null>(null)
  const [projects, setProjects] = useState<ProjectSnapshot>({ projects: [], assignments: {}, refreshedAt: 0 })
  const [projectError, setProjectError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AppSettings>({ locale: 'en', customCliPath: null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scope, setScope] = useState('all')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteTasks, setDeleteTasks] = useState<ThreadRecord[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const selectAll = useRef<HTMLInputElement>(null)
  const started = useRef(false)
  const locked = loading || busy
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await api.listThreads()); setError(null); setSelected(new Set())
      try { setProjects(await api.listProjects()); setProjectError(null) }
      catch (caught) { setProjectError(String(caught instanceof Error ? caught.message : caught)) }
    }
    catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)) }
    finally { setLoading(false) }
  }, [api])
  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const next = await api.getSettings()
        setSettings(next)
        await i18n.changeLanguage(next.locale)
        await refresh()
      } catch (caught) { setError(String(caught)); setLoading(false) }
    })()
  }, [api, i18n, refresh])
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot])
  const inventory = useMemo(() => desktopInventory(threads), [threads])
  const deletionBlocks = useMemo(() => desktopDeletionBlocks(threads), [threads])
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(settings.locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), [settings.locale])
  const navigation = useMemo(() => desktopNavigation(inventory.tasks, projects), [inventory.tasks, projects])
  const groups = useMemo(() => [...navigation.projects, ...navigation.directories, ...navigation.standalone], [navigation])
  const visible = useMemo(() => {
    const source = scope === 'orphaned' ? inventory.orphaned : scope === 'all' ? inventory.tasks
      : scope.startsWith('task:') ? inventory.tasks.filter((thread) => `task:${thread.id}` === scope)
      : groups.find((group) => group.id === scope)?.threads ?? []
    const query = filters.query.trim().toLocaleLowerCase()
    const matches = new Set(filterThreads(source, filters).map((thread) => thread.id))
    const projectMatches = new Set(navigation.projects.filter((group) => group.name.toLocaleLowerCase().includes(query))
      .flatMap((group) => group.threads.map((thread) => thread.id)))
    return filterThreads(source, { ...filters, query: '' }).filter((thread) => !query || matches.has(thread.id) || projectMatches.has(thread.id))
  }, [filters, groups, inventory, navigation.projects, scope])
  const eligible = visible.filter((thread) => thread.status !== 'active')
  const allSelected = eligible.length > 0 && eligible.every((thread) => selected.has(thread.id))
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = !allSelected && selected.size > 0
  }, [allSelected, selected])
  const picked = visible.filter((thread) => selected.has(thread.id))
  const deletable = picked.filter((thread) => !deletionBlocks.has(thread.id))
  const protectedCount = picked.length - deletable.length
  const changeScope = (next: string): void => { setScope(next); setSelected(new Set()) }
  const changeFilter = (next: Partial<typeof filters>): void => {
    setFilters((current) => ({ ...current, ...next })); setSelected(new Set())
  }
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null); setNotice(null)
    try { await operation() } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)) }
    finally { setBusy(false) }
  }
  const mutate = (operation: () => Promise<BatchOperationResult>): void => {
    void run(async () => {
      const result = await operation()
      setDeleteTasks(null)
      await refresh()
      setNotice(t('operationDone', { success: result.succeeded.length, failed: result.failed.length, skipped: result.skipped.length }))
      const issues = [...result.failed, ...result.skipped].map((item) => `${item.id}: ${item.message}`)
      if (result.directoryCleanup) issues.push(...[...result.directoryCleanup.failed, ...result.directoryCleanup.skipped].map((item) => `${item.path}: ${item.message}`))
      if (result.desktopRecentsCleanup?.error) issues.push(result.desktopRecentsCleanup.error)
      if (issues.length) setError(issues.join('\n'))
    })
  }
  const openDelete = (items: ThreadRecord[]): void => {
    const roots = resolveThreadSelection(threads, items.map((item) => item.id)).roots
    setDeleteTasks(items.filter((item) => roots.has(item.id)))
  }
  const icon = (label: string, children: ReactNode, action: () => void, disabled = locked, danger = false) => (
    <button type="button" className={`icon-button${danger ? ' icon-button--danger' : ''}`} title={label} aria-label={label} disabled={disabled} onClick={action}>{children}</button>
  )
  const groupName = (group: typeof groups[number]): string => group.kind === 'standalone' ? t('standaloneTasks') : group.name
  const currentGroup = groups.find((group) => group.id === scope)
  const currentTask = scope.startsWith('task:') ? inventory.tasks.find((thread) => `task:${thread.id}` === scope) : null
  const title = scope === 'orphaned' ? text('Unlinked agent tasks', '无主子任务') : scope === 'all' ? text('All tasks', '全部任务') : currentTask ? currentTask.title : currentGroup ? groupName(currentGroup) : t('noThreadsTitle')
  const blockLabel = (thread: ThreadRecord): string => {
    const reason = deletionBlocks.get(thread.id)
    return reason === 'descendant' ? text('A child task is running or pinned', '子任务正在运行或已置顶，暂不可删除') : reason === 'active' ? t('activeCannotSelect') : reason === 'pinned' ? t('pinnedCannotDelete') : t('delete')
  }
  return <div className="desktop-shell">
    <aside className="desktop-sidebar">
      <div className="desktop-brand"><img src={appIcon} alt="" /><div><h1>Threadbox</h1><span>v{packageJson.version}</span></div></div>
      <DesktopNavigation navigation={navigation} scope={scope} count={inventory.tasks.length}
        projectState={loading ? 'loading' : projectError ? 'error' : 'ready'}
        onScope={changeScope} onTask={(id) => { changeScope(`task:${id}`); setFilters(DEFAULT_FILTERS) }} />
      <div className="desktop-sidebar-footer">
        {inventory.orphaned.length > 0 && <button className={scope === 'orphaned' ? 'is-current' : ''} onClick={() => changeScope('orphaned')}><Trash2 size={16} /><span>{text('Unlinked agent tasks', '无主子任务')}</span><small>{inventory.orphaned.length}</small></button>}
        <button onClick={() => setSettingsOpen(true)} disabled={locked}><Settings size={16} /><span>{t('settings')}</span></button>
        <div className="desktop-runtime">{snapshot?.environment.cliVersion ? `Codex ${snapshot.environment.cliVersion}` : ''}</div>
      </div>
    </aside>
    <main className="desktop-main">
      <header className="desktop-heading"><div><h2>{title}</h2><span>{t('taskCount', { count: visible.length })}</span></div>{icon(t('refresh'), <RefreshCw size={18} className={loading ? 'spin' : ''} />, () => void refresh())}</header>
      <section className="desktop-toolbar" aria-label={text('Filters', '筛选')}>
        <label className="search-field"><Search size={17} /><input aria-label={t('search')} placeholder={t('search')} value={filters.query} onChange={(event) => changeFilter({ query: event.target.value })} />{filters.query && icon(t('close'), <X size={15} />, () => changeFilter({ query: '' }), false)}</label>
        <div className="segmented-control" role="group" aria-label={t('state')}>{(['all', 'active', 'archived'] as const).map((value) => <button key={value} aria-pressed={filters.archive === value} className={filters.archive === value ? 'is-active' : ''} onClick={() => changeFilter({ archive: value })}>{t(value === 'all' ? 'all' : value === 'active' ? 'activeThreads' : 'archivedThreads')}</button>)}</div>
        <details className="desktop-filters"><summary title={text('More filters', '更多筛选')} aria-label={text('More filters', '更多筛选')}><SlidersHorizontal size={18} />{(filters.age !== 'all' || filters.source !== 'all' || filters.sort !== 'updated-desc') && <span className="filter-dot" />}</summary><div>
          <label>{t('source')}<select value={filters.source} onChange={(event) => changeFilter({ source: event.target.value })}><option value="all">{t('allSources')}</option>{[...new Set(threads.map((thread) => thread.source))].map((source) => <option key={source}>{source}</option>)}</select></label>
          <label>{t('updated')}<select value={filters.age} onChange={(event) => changeFilter({ age: event.target.value as typeof filters.age })}>{(['all', '7', '30', '90'] as const).map((age) => <option key={age} value={age}>{t(age === 'all' ? 'anyTime' : age === '7' ? 'last7Days' : age === '30' ? 'last30Days' : 'last90Days')}</option>)}</select></label>
          <label>{text('Sort', '排序')}<select value={filters.sort} onChange={(event) => changeFilter({ sort: event.target.value as typeof filters.sort })}><option value="updated-desc">{t('newest')}</option><option value="updated-asc">{t('oldest')}</option><option value="title-asc">{t('titleSort')}</option></select></label>
          <button className="button button--secondary" onClick={() => changeFilter({ age: 'all', source: 'all', sort: 'updated-desc' })}>{text('Reset filters', '重置筛选')}</button>
        </div></details>
      </section>
      {projectError && <div className="desktop-banner" role="alert"><span>{text('Projects could not be loaded: ', '项目读取失败：')}{projectError}</span></div>}
      {snapshot?.desktopRecents.state === 'stale' && <div className="desktop-banner"><span>{t('recentsStale', { count: snapshot.desktopRecents.staleCount })}</span><button className="button button--quiet" disabled={locked} onClick={() => setRepairOpen(true)}>{t('recentsRepair')}</button></div>}
      <section className="desktop-selection">
        <label><input ref={selectAll} type="checkbox" aria-label={t('selectVisible')} checked={allSelected} disabled={locked || !eligible.length} onChange={() => setSelected(allSelected ? new Set() : new Set(eligible.map((thread) => thread.id)))} /><span>{selected.size ? t('selected', { count: selected.size }) : text('Select tasks', '选择任务')}{protectedCount > 0 && <small className="desktop-protected-count">{text(` / ${protectedCount} protected from deletion`, ` / ${protectedCount} 项受保护，不会删除`)}</small>}</span></label>
        {selected.size > 0 && <div className="desktop-batch">
          {icon(t('archive'), <Archive size={17} />, () => mutate(() => api.archiveThreads(picked.filter((item) => !item.archived).map((item) => item.id))), locked || picked.every((item) => item.archived))}
          {icon(t('unarchive'), <ArchiveRestore size={17} />, () => mutate(() => api.unarchiveThreads(picked.filter((item) => item.archived).map((item) => item.id))), locked || picked.every((item) => !item.archived))}
          {snapshot?.environment.capabilities.pinning && icon(picked.every((item) => item.pinned) ? t('unpin') : t('pin'), <Pin size={17} />, () => mutate(() => api.setPinned(picked.map((item) => item.id), !picked.every((item) => item.pinned))))}
          {icon(t('delete'), <Trash2 size={17} />, () => openDelete(deletable), locked || !deletable.length, true)}
          {icon(t('clearSelection'), <X size={17} />, () => setSelected(new Set()), locked)}
        </div>}
      </section>
      <div className="desktop-list" aria-busy={locked}>
        {loading && !snapshot ? <div className="center-state"><LoaderCircle className="spin" /><p>{t('loading')}</p></div> : !snapshot ? <div className="center-state"><Inbox size={32} /><h2>{t('cliMissingTitle')}</h2><button className="button button--primary" onClick={() => void refresh()}>{t('retry')}</button></div> : visible.length === 0 ? <div className="center-state"><Inbox size={32} /><h2>{t('noThreadsTitle')}</h2>{(filters.query || filters.source !== 'all' || filters.age !== 'all' || filters.archive !== 'all') && <button className="button button--secondary" onClick={() => changeFilter(DEFAULT_FILTERS)}>{text('Clear filters', '清除筛选')}</button>}</div> : visible.map((thread) => <article key={thread.id} className={`desktop-task${selected.has(thread.id) ? ' is-selected' : ''}`} aria-label={thread.title}>
          <input type="checkbox" aria-label={`${t('thread')}: ${thread.title}`} checked={selected.has(thread.id)} disabled={locked || thread.status === 'active'} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(thread.id)) next.delete(thread.id); else next.add(thread.id); return next })} />
          <div className="desktop-task-body"><div className="desktop-task-title"><strong title={thread.title}>{thread.title}</strong>{thread.pinned && <Pin size={13} aria-label={t('statusPinned')} />}{thread.archived && <Archive size={13} aria-label={t('statusArchived')} />}</div><div className="desktop-task-meta"><span title={thread.cwd}>{thread.cwd}</span><span>{thread.source}</span>{deletionBlocks.get(thread.id) === 'descendant' && <span className="desktop-protected">{blockLabel(thread)}</span>}</div></div>
          <div className="desktop-task-state"><span className={`state-label state-label--${thread.status}`}><span className="state-dot" />{t(thread.status === 'active' ? 'statusActive' : thread.status === 'systemError' ? 'statusError' : thread.status === 'idle' ? 'statusIdle' : 'statusReady')}</span><time title={formatTimestamp(thread.updatedAt, settings.locale)}>{dateFormat.format(thread.updatedAt * 1000)}</time></div>
          <div className="desktop-row-actions">
            {icon(t('openDirectory'), <FolderOpen size={16} />, () => void run(async () => { const message = await api.openWorkingDirectory(thread.cwd); if (message) throw new Error(message) }))}
            {icon(t('copyId'), <Copy size={15} />, () => void run(async () => { await api.copyThreadId(thread.id); setNotice(t('copied')) }))}
            {snapshot.environment.capabilities.pinning && icon(thread.pinned ? t('unpin') : t('pin'), thread.pinned ? <PinOff size={15} /> : <Pin size={15} />, () => mutate(() => api.setPinned([thread.id], !thread.pinned)), locked || thread.status === 'active')}
            {icon(thread.archived ? t('unarchive') : t('archive'), thread.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />, () => mutate(() => thread.archived ? api.unarchiveThreads([thread.id]) : api.archiveThreads([thread.id])), locked || thread.status === 'active')}
            {icon(blockLabel(thread), <Trash2 size={16} />, () => openDelete([thread]), locked || deletionBlocks.has(thread.id), true)}
          </div>
        </article>)}
      </div>
      {(error || notice) && <div className={`desktop-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}><span>{error ?? notice}</span>{icon(t('close'), <X size={15} />, () => { setError(null); setNotice(null) }, false)}</div>}
    </main>
    {deleteTasks && <DeleteDialog threads={deleteTasks} externalProcesses={snapshot?.environment.externalCodexProcesses ?? 0} busy={busy} allowDirectoryTrash onClose={() => setDeleteTasks(null)} onConfirm={(ids, trashWorkingDirectories) => mutate(() => api.deleteThreads(ids, { trashWorkingDirectories }))} />}
    {settingsOpen && <SettingsDialog settings={settings} environment={snapshot?.environment ?? { state: 'error', cliPath: null, cliVersion: null, minimumVersion: '0.149.0', message: error, externalCodexProcesses: 0, capabilities: { pinning: false } }} busy={busy} allowBrowse onClose={() => setSettingsOpen(false)} onBrowse={() => api.chooseCliPath()} onSave={(next) => void run(async () => { const saved = await api.updateSettings(next); setSettings(saved); await i18n.changeLanguage(saved.locale); setSettingsOpen(false); await refresh() })} />}
    {repairOpen && snapshot && <RecentsRepairDialog status={snapshot.desktopRecents} busy={busy} onClose={() => setRepairOpen(false)} onConfirm={() => void run(async () => { const result = await api.repairDesktopRecents(); setRepairOpen(false); await refresh(); setNotice(t('recentsRepairDone', { count: result.removed })) })} />}
  </div>
}
