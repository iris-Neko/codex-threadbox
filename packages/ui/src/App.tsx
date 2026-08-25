import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  DatabaseZap,
  FolderDown,
  FolderInput,
  FolderKanban,
  FolderPlus,
  Folders,
  Inbox,
  Layers3,
  List,
  LoaderCircle,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X
} from 'lucide-react'
import packageJson from '../../../package.json'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppSettings,
  BatchOperationResult,
  DesktopRecentsStatus,
  EnvironmentStatus,
  PlatformCapabilities,
  ProjectRecord,
  ProjectSnapshot,
  ThreadboxApi,
  ThreadRecord
} from '../../../src/shared/contracts'
import { DeleteDialog } from './components/DeleteDialog'
import { CreateThreadDialog } from './components/CreateThreadDialog'
import { ProjectDialog } from './components/ProjectDialog'
import { RecentsRepairDialog } from './components/RecentsRepairDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ThreadTable } from './components/ThreadTable'
import {
  DEFAULT_FILTERS,
  deselectThreadSubtrees,
  filterThreads,
  flattenThreadTree,
  groupThreadRows,
  groupThreads,
  resolveThreadSelection,
  selectThreadRoots,
  toggleThreadSelection,
  type AgeFilter,
  type ArchiveFilter,
  type SortMode,
  type ThreadViewMode,
  type ThreadFilters
} from './thread-utils'

const INITIAL_ENVIRONMENT: EnvironmentStatus = {
  state: 'error',
  cliPath: null,
  cliVersion: null,
  minimumVersion: '0.149.0',
  message: null,
  externalCodexProcesses: 0,
  capabilities: { pinning: false }
}

function operationSummary(
  result: BatchOperationResult,
  translate: TFunction
): string {
  const taskSummary = translate('operationDone', {
    success: result.succeeded.length,
    failed: result.failed.length,
    skipped: result.skipped.length
  })
  const details: string[] = [taskSummary]
  if (result.directoryCleanup && result.directoryCleanup.requested.length > 0) {
    details.push(translate('directoryCleanupDone', {
      trashed: result.directoryCleanup.trashed.length,
      kept: result.directoryCleanup.failed.length + result.directoryCleanup.skipped.length
    }))
  }
  if (result.desktopRecentsCleanup?.error) {
    details.push(translate('recentsCleanupFailed'))
  } else if ((result.desktopRecentsCleanup?.removed ?? 0) > 0) {
    details.push(translate('recentsCleanupDone', { count: result.desktopRecentsCleanup?.removed }))
  }
  return details.join(' ')
}

const DEFAULT_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  host: 'desktop',
  projectManagement: false,
  desktopRecentsRepair: true,
  directoryTrash: true,
  chooseCliPath: true,
  openWorkingDirectory: true,
  currentWorkspaceDirectories: []
}

export interface ThreadboxAppProps {
  api: ThreadboxApi
  version?: string
}

const EMPTY_PROJECTS: ProjectSnapshot = { projects: [], assignments: {}, refreshedAt: 0 }

export default function App({ api, version = packageJson.version }: ThreadboxAppProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const booted = useRef(false)
  const [settings, setSettings] = useState<AppSettings>({ locale: 'en', customCliPath: null })
  const [environment, setEnvironment] = useState<EnvironmentStatus>(INITIAL_ENVIRONMENT)
  const [platform, setPlatform] = useState<PlatformCapabilities>(DEFAULT_PLATFORM_CAPABILITIES)
  const [threads, setThreads] = useState<ThreadRecord[]>([])
  const [projects, setProjects] = useState<ProjectSnapshot>(EMPTY_PROJECTS)
  const [desktopRecents, setDesktopRecents] = useState<DesktopRecentsStatus>({
    state: 'unavailable',
    staleCount: 0,
    staleEntries: [],
    message: null
  })
  const [filters, setFilters] = useState<ThreadFilters>(DEFAULT_FILTERS)
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set())
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ThreadViewMode>('projects')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const [recentsRepairOpen, setRecentsRepairOpen] = useState(false)
  const [projectDialog, setProjectDialog] = useState<ProjectRecord | 'new' | null>(null)
  const [threadProject, setThreadProject] = useState<ProjectRecord | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.listThreads()
      const projectSnapshot = await api.listProjects()
      setThreads(result.threads)
      setProjects(projectSnapshot)
      setEnvironment(result.environment)
      setDesktopRecents(result.desktopRecents)
      const selectable = new Set(result.threads
        .filter((thread) => platform.projectManagement || thread.status !== 'active')
        .map((thread) => thread.id))
      setSelected(
        (current) =>
          resolveThreadSelection(
            result.threads,
            [...current].filter((id) => selectable.has(id))
          ).roots
      )
    } catch (caught) {
      const status = await api.getEnvironmentStatus().catch(() => INITIAL_ENVIRONMENT)
      setEnvironment(status)
      setError(caught instanceof Error ? caught.message : t('unknownError'))
    } finally {
      setLoading(false)
    }
  }, [api, platform.projectManagement, t])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const [currentSettings, currentPlatform] = await Promise.all([
        api.getSettings(),
        api.getPlatformCapabilities()
      ])
      setSettings(currentSettings)
      setPlatform(currentPlatform)
      await i18n.changeLanguage(currentSettings.locale)
      await refresh()
    })()
  }, [api, i18n, refresh])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const groupMode = viewMode === 'directories' ? 'directories' : 'projects'
  const projectContext = platform.projectManagement ? projects : null
  const matchedThreads = useMemo(
    () => filterThreads(
      threads,
      filters,
      Math.floor(Date.now() / 1000),
      platform.currentWorkspaceDirectories,
      projectContext,
      groupMode
    ),
    [filters, groupMode, platform.currentWorkspaceDirectories, projectContext, threads]
  )
  const treeRows = useMemo(
    () =>
      flattenThreadTree(
        threads,
        matchedThreads,
        expandedThreads,
        filters.query.trim().length > 0,
        collapsedThreads
      ),
    [collapsedThreads, expandedThreads, filters.query, matchedThreads, threads]
  )
  const visibleThreads = useMemo(() => treeRows.map((row) => row.thread), [treeRows])
  const workspaceGroups = useMemo(
    () => groupThreads(threads, projectContext, groupMode),
    [groupMode, projectContext, threads]
  )
  const trashGroup = useMemo(
    () => groupThreads(threads, projectContext, 'projects')
      .find((group) => group.project?.systemKind === 'trash') ?? null,
    [projectContext, threads]
  )
  const trashedThreadIds = useMemo(
    () => new Set(trashGroup?.threads.map((thread) => thread.id) ?? []),
    [trashGroup]
  )
  const rowGroups = useMemo(
    () => groupThreadRows(threads, treeRows, projectContext, groupMode),
    [groupMode, projectContext, threads, treeRows]
  )
  const selection = useMemo(
    () => resolveThreadSelection(threads, selected),
    [selected, threads]
  )
  const selectedRootThreads = useMemo(
    () => threads.filter((thread) => selection.roots.has(thread.id)),
    [selection.roots, threads]
  )
  const selectedThreads = useMemo(
    () => threads.filter((thread) => selection.effective.has(thread.id)),
    [selection.effective, threads]
  )
  const selectableVisible = useMemo(
    () =>
      treeRows
        .filter((row) => row.matchesFilter &&
          (platform.projectManagement || row.thread.status !== 'active'))
        .map((row) => row.thread),
    [platform.projectManagement, treeRows]
  )
  const allSelectableSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((thread) => selection.effective.has(thread.id))
  const someSelectableSelected = selectableVisible.some((thread) =>
    selection.effective.has(thread.id)
  )
  const sources = useMemo(
    () => [...new Set(threads.map((thread) => thread.source))].toSorted(),
    [threads]
  )
  const directories = useMemo(
    () => [...new Set(threads.map((thread) => thread.cwd))].toSorted(),
    [threads]
  )
  const deleteThreads = useMemo(
    () => (deleteIds ? threads.filter((thread) => deleteIds.includes(thread.id)) : []),
    [deleteIds, threads]
  )
  const customProjects = useMemo(
    () => projects.projects.filter((project) => project.kind === 'threadbox'),
    [projects.projects]
  )

  const setFilter = <K extends keyof ThreadFilters>(key: K, value: ThreadFilters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const runOperation = useCallback(
    async (operation: () => Promise<BatchOperationResult>, closeDelete = false): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const result = await operation()
        const summary = operationSummary(result, t)
        setNotice(summary)
        setSelected(new Set())
        if (closeDelete) setDeleteIds(null)
        await refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('operationFailed'))
      } finally {
        setBusy(false)
      }
    },
    [refresh, t]
  )

  const runProjectOperation = useCallback(
    async (operation: () => Promise<ProjectSnapshot | null>, closeDialog = false): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const snapshot = await operation()
        if (!snapshot) return
        setProjects(snapshot)
        setNotice(t('projectUpdated'))
        setSelected(new Set())
        if (closeDialog) setProjectDialog(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('operationFailed'))
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  const moveToTrash = useCallback((ids: string[]): void => {
    if (!api.trashThreads || ids.length === 0) return
    if (!window.confirm(t('moveToTrashConfirm', { count: ids.length }))) return
    void runOperation(() => api.trashThreads!(ids))
  }, [api, runOperation, t])

  const restoreFromTrash = useCallback((ids: string[]): void => {
    if (!api.restoreThreadsFromTrash || ids.length === 0) return
    void runOperation(() => api.restoreThreadsFromTrash!(ids))
  }, [api, runOperation])

  const emptyTrash = useCallback((): void => {
    if (!api.emptyTrash || !window.confirm(t('emptyTrashConfirm'))) return
    void runOperation(() => api.emptyTrash!())
  }, [api, runOperation, t])

  const createThread = async (project: ProjectRecord, name: string): Promise<void> => {
    if (!api.createThreadInProject) {
      setError(t('projectThreadCreationUnavailable'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.createThreadInProject(project.id, name)
      setThreadProject(null)
      if (!created) return
      setNotice(t('threadCreated', { name: created.name }))
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const repairDesktopRecents = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.repairDesktopRecents()
      setDesktopRecents(result.status)
      setRecentsRepairOpen(false)
      setNotice(t('recentsRepairDone', { count: result.removed }))
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleThread = (id: string): void => {
    setSelected((current) => toggleThreadSelection(threads, current, id))
  }

  const toggleVisible = (): void => {
    const visibleIds = selectableVisible.map((thread) => thread.id)
    setSelected((current) =>
      allSelectableSelected
        ? deselectThreadSubtrees(threads, current, visibleIds)
        : selectThreadRoots(threads, current, visibleIds)
    )
  }

  const toggleExpanded = (id: string, currentlyExpanded: boolean): void => {
    setExpandedThreads((current) => {
      const next = new Set(current)
      if (currentlyExpanded) next.delete(id)
      else next.add(id)
      return next
    })
    setCollapsedThreads((current) => {
      const next = new Set(current)
      if (currentlyExpanded) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleGroup = (id: string): void => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveSettings = async (next: AppSettings): Promise<void> => {
    setBusy(true)
    try {
      const updated = await api.updateSettings(next)
      setSettings(updated)
      await i18n.changeLanguage(updated.locale)
      setSettingsOpen(false)
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('unknownError'))
    } finally {
      setBusy(false)
    }
  }

  const changeViewMode = (mode: ThreadViewMode): void => {
    setViewMode(mode)
    setFilter('workspace', 'all')
  }

  const archiveSelected = selectedRootThreads
    .filter((thread) => !trashedThreadIds.has(thread.id) &&
      thread.status !== 'active' && !thread.archived)
    .map((thread) => thread.id)
  const unarchiveSelected = selectedRootThreads
    .filter((thread) => !trashedThreadIds.has(thread.id) &&
      thread.status !== 'active' && thread.archived)
    .map((thread) => thread.id)
  const trashSelected = selectedRootThreads
    .filter((thread) => !trashedThreadIds.has(thread.id) &&
      thread.status !== 'active' && !thread.pinned)
    .map((thread) => thread.id)
  const restoreSelected = selectedRootThreads
    .filter((thread) => trashedThreadIds.has(thread.id))
    .map((thread) => thread.id)
  const pinnedSelected = selectedThreads
    .filter((thread) => thread.status !== 'active' && thread.pinned)
    .map((thread) => thread.id)
  const unpinnedSelected = selectedThreads
    .filter((thread) => thread.status !== 'active' && !thread.pinned)
    .map((thread) => thread.id)
  const ready = environment.state === 'ready'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Inbox size={21} />
          </span>
          <div>
            <h1>{t('appName')}</h1>
            <span className="brand__version">v{version}</span>
          </div>
        </div>
        <div className="header-stats" aria-live="polite">
          <span>{t('taskCount', { count: matchedThreads.filter((thread) => !thread.internal).length })}</span>
          {matchedThreads.some((thread) => thread.internal) && (
            <span>
              {t('spawnedTaskCount', {
                count: matchedThreads.filter((thread) => thread.internal).length
              })}
            </span>
          )}
          <span>{environment.cliVersion ? `Codex ${environment.cliVersion}` : 'Codex -'}</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            type="button"
            title={t('refresh')}
            aria-label={t('refresh')}
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} className={loading ? 'spin' : undefined} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('settings')}
            aria-label={t('settings')}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {ready && (
        <>
          <section className="filter-bar" aria-label="Filters">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                value={filters.query}
                onChange={(event) => setFilter('query', event.target.value)}
                placeholder={t('search')}
              />
              {filters.query && (
                <button
                  className="search-clear"
                  type="button"
                  onClick={() => setFilter('query', '')}
                  aria-label={t('close')}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </label>
            {platform.projectManagement && (
              <>
                {platform.workspaceProjectImport && api.importCurrentWorkspaceProject && (
                  <button
                    className="button button--secondary button--icon-text"
                    type="button"
                    disabled={busy}
                    onClick={() => void runProjectOperation(
                      () => api.importCurrentWorkspaceProject!()
                    )}
                  >
                    <FolderDown size={15} aria-hidden="true" />
                    {t('importWorkspace')}
                  </button>
                )}
                <button
                  className="button button--secondary button--icon-text"
                  type="button"
                  disabled={busy}
                  onClick={() => setProjectDialog('new')}
                >
                  <FolderPlus size={15} aria-hidden="true" />
                  {t('newProject')}
                </button>
              </>
            )}
            <div className="segmented-control view-control" role="group" aria-label={t('viewMode')}>
              <button
                type="button"
                className={viewMode === 'projects' ? 'is-active' : undefined}
                title={t('projectsView')}
                onClick={() => changeViewMode('projects')}
              >
                {platform.projectManagement
                  ? <FolderKanban size={15} aria-hidden="true" />
                  : <Layers3 size={15} aria-hidden="true" />}
                {platform.projectManagement ? t('projects') : t('grouped')}
              </button>
              {platform.projectManagement && (
                <button
                  type="button"
                  className={viewMode === 'directories' ? 'is-active' : undefined}
                  title={t('directoriesView')}
                  onClick={() => changeViewMode('directories')}
                >
                  <Folders size={15} aria-hidden="true" />
                  {t('directories')}
                </button>
              )}
              <button
                type="button"
                className={viewMode === 'flat' ? 'is-active' : undefined}
                title={t('flatView')}
                onClick={() => changeViewMode('flat')}
              >
                <List size={15} aria-hidden="true" />
                {t('flat')}
              </button>
            </div>
            <div className="segmented-control" role="group">
              {(['all', 'active', 'archived'] as ArchiveFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={filters.archive === value ? 'is-active' : undefined}
                  onClick={() => setFilter('archive', value)}
                >
                  {value === 'all'
                    ? t('all')
                    : value === 'active'
                      ? t('activeThreads')
                      : t('archivedThreads')}
                </button>
              ))}
            </div>
            <select
              className="workspace-filter"
              value={filters.workspace}
              title={viewMode === 'projects' ? t('allProjects') : t('allWorkspaces')}
              onChange={(event) => setFilter('workspace', event.target.value)}
            >
              <option value="all">
                {viewMode === 'projects' ? t('allProjects') : t('allWorkspaces')}
              </option>
              {platform.currentWorkspaceDirectories.length > 0 && (
                <option value="__current__">{t('currentWorkspace')}</option>
              )}
              {workspaceGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.kind === 'threadboxProject'
                    ? group.project?.systemKind === 'trash'
                      ? t('trash')
                      : t('threadboxProjectOption', { name: group.name })
                    : group.kind === 'standalone'
                    ? t('standaloneTasks')
                    : group.kind === 'desktopProject'
                      ? t('desktopProjectOption', { name: group.name })
                      : t('localWorkspaceOption', { name: group.name })}
                </option>
              ))}
            </select>
            <select value={filters.source} onChange={(event) => setFilter('source', event.target.value)}>
              <option value="all">{t('allSources')}</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <select
              className="directory-filter"
              value={filters.directory}
              title={filters.directory === 'all' ? t('allDirectories') : filters.directory}
              onChange={(event) => setFilter('directory', event.target.value)}
            >
              <option value="all">{t('allDirectories')}</option>
              {directories.map((directory) => (
                <option key={directory} value={directory}>
                  {directory}
                </option>
              ))}
            </select>
            <select value={filters.age} onChange={(event) => setFilter('age', event.target.value as AgeFilter)}>
              <option value="all">{t('anyTime')}</option>
              <option value="7">{t('last7Days')}</option>
              <option value="30">{t('last30Days')}</option>
              <option value="90">{t('last90Days')}</option>
            </select>
            <select value={filters.sort} onChange={(event) => setFilter('sort', event.target.value as SortMode)}>
              <option value="updated-desc">{t('newest')}</option>
              <option value="updated-asc">{t('oldest')}</option>
              <option value="created-desc">{t('created')}</option>
              <option value="title-asc">{t('titleSort')}</option>
            </select>
          </section>

          {environment.externalCodexProcesses > 0 && (
            <div className="process-warning">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{t('externalProcesses', { count: environment.externalCodexProcesses })}</span>
            </div>
          )}

          {platform.desktopRecentsRepair && desktopRecents.state === 'stale' && (
            <div className="process-warning process-warning--recents">
              <DatabaseZap size={15} aria-hidden="true" />
              <span>{t('recentsStale', { count: desktopRecents.staleCount })}</span>
              <button
                className="button button--quiet process-warning__action"
                type="button"
                disabled={busy}
                onClick={() => setRecentsRepairOpen(true)}
              >
                <DatabaseZap size={15} aria-hidden="true" />
                {t('recentsRepair')}
              </button>
            </div>
          )}

          <section className="selection-bar" aria-live="polite">
            {selection.roots.size === 0 ? (
              <span className="selection-placeholder">
                {t('taskCount', {
                  count: visibleThreads.filter((thread) => !thread.internal).length
                })}
              </span>
            ) : (
              <>
                <strong>
                  {selection.implicit.size > 0
                    ? t('selectedWithDescendants', {
                        total: selection.effective.size,
                        explicit: selection.roots.size,
                        automatic: selection.implicit.size
                      })
                    : t('selected', { count: selection.roots.size })}
                </strong>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  title={t('clearSelection')}
                  aria-label={t('clearSelection')}
                  onClick={() => setSelected(new Set())}
                >
                  <X size={15} aria-hidden="true" />
                </button>
                <span className="selection-divider" />
                {platform.projectManagement && (
                  <label className="project-move-control">
                    <FolderInput size={15} aria-hidden="true" />
                    <select
                      value=""
                      disabled={busy}
                      aria-label={t('moveToProject')}
                      onChange={(event) => {
                        const value = event.target.value
                        if (!value) return
                        void runProjectOperation(() =>
                          api.assignThreads(
                            [...selection.roots],
                            value === '__unassigned__' ? null : value
                          )
                        )
                      }}
                    >
                      <option value="" disabled>{t('moveToProject')}</option>
                      <option value="__unassigned__">{t('removeFromProject')}</option>
                      {customProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.systemKind === 'trash' ? t('trash') : project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || archiveSelected.length === 0}
                  onClick={() => void runOperation(() => api.archiveThreads(archiveSelected))}
                >
                  <Archive size={15} aria-hidden="true" />
                  {t('archive')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || unarchiveSelected.length === 0}
                  onClick={() => void runOperation(() => api.unarchiveThreads(unarchiveSelected))}
                >
                  <ArchiveRestore size={15} aria-hidden="true" />
                  {t('unarchive')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  title={!environment.capabilities.pinning ? t('pinningUnavailable') : undefined}
                  disabled={busy || !environment.capabilities.pinning || unpinnedSelected.length === 0}
                  onClick={() => void runOperation(() => api.setPinned(unpinnedSelected, true))}
                >
                  <Pin size={15} aria-hidden="true" />
                  {t('pin')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  title={!environment.capabilities.pinning ? t('pinningUnavailable') : undefined}
                  disabled={busy || !environment.capabilities.pinning || pinnedSelected.length === 0}
                  onClick={() => void runOperation(() => api.setPinned(pinnedSelected, false))}
                >
                  <PinOff size={15} aria-hidden="true" />
                  {t('unpin')}
                </button>
                {platform.taskTrash && restoreSelected.length > 0 && (
                  <button
                    className="button button--quiet"
                    type="button"
                    title={t('restoreFromTrashHint')}
                    disabled={busy}
                    onClick={() => restoreFromTrash(restoreSelected)}
                  >
                    <ArchiveRestore size={15} aria-hidden="true" />
                    {t('restoreFromTrash')}
                  </button>
                )}
                <button
                  className="button button--quiet-danger"
                  type="button"
                  title={t(platform.taskTrash ? 'moveToTrashHint' : 'deleteHint')}
                  disabled={busy || (platform.taskTrash
                    ? trashSelected.length === 0
                    : selectedRootThreads.every((thread) =>
                      thread.status === 'active' || thread.pinned))}
                  onClick={() => platform.taskTrash
                    ? moveToTrash(trashSelected)
                    : setDeleteIds([...selection.roots])}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t(platform.taskTrash ? 'moveToTrash' : 'delete')}
                </button>
              </>
            )}
          </section>
        </>
      )}

      <main className="content-area">
        {loading && threads.length === 0 ? (
          <div className="center-state">
            <LoaderCircle size={24} className="spin" aria-hidden="true" />
            <p>{t('loading')}</p>
          </div>
        ) : !ready ? (
          <div className="center-state center-state--error">
            <AlertTriangle size={28} aria-hidden="true" />
            <h2>{t('cliMissingTitle')}</h2>
            <p>{environment.message ?? t('cliMissingBody', { minimum: environment.minimumVersion })}</p>
            <div className="center-state__actions">
              <button className="button button--primary" type="button" onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden="true" />
                {t('retry')}
              </button>
              <button className="button button--secondary" type="button" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon size={16} aria-hidden="true" />
                {t('settings')}
              </button>
            </div>
          </div>
        ) : matchedThreads.length === 0 && !(threads.length === 0 &&
          viewMode === 'projects' && customProjects.length > 0) ? (
          <div className="center-state">
            <Inbox size={30} aria-hidden="true" />
            <h2>{t('noThreadsTitle')}</h2>
            <p>{t('noThreads')}</p>
          </div>
        ) : (
          <ThreadTable
            rows={treeRows}
            groups={viewMode !== 'flat' ? rowGroups : null}
            collapsedGroups={collapsedGroups}
            forceGroupsExpanded={filters.query.trim().length > 0}
            selected={selection.effective}
            implicitlySelected={selection.implicit}
            locale={settings.locale}
            allSelectableSelected={allSelectableSelected}
            someSelectableSelected={someSelectableSelected}
            allowOpenDirectory={platform.openWorkingDirectory}
            allowActiveSelection={platform.projectManagement}
            allowProjectThreadCreation={Boolean(platform.projectThreadCreation)}
            taskTrash={Boolean(platform.taskTrash)}
            trashedThreadIds={trashedThreadIds}
            projectMutationDisabled={busy}
            onToggle={toggleThread}
            onToggleVisible={toggleVisible}
            onToggleExpanded={toggleExpanded}
            onToggleGroup={toggleGroup}
            onOpenDirectory={(path) => {
              void api.openWorkingDirectory(path).then((message) => message && setError(message))
            }}
            onCopyId={(id) => {
              void api.copyThreadId(id).then(() => setNotice(t('copied')))
            }}
            onArchive={(thread) =>
              void runOperation(() =>
                thread.archived
                  ? api.unarchiveThreads([thread.id])
                  : api.archiveThreads([thread.id])
              )
            }
            onDelete={(thread) => {
              if (!platform.taskTrash) {
                setDeleteIds([thread.id])
              } else if (trashedThreadIds.has(thread.id)) {
                restoreFromTrash([thread.id])
              } else {
                moveToTrash([thread.id])
              }
            }}
            onCreateThread={(project) => setThreadProject(project)}
            onRenameProject={(project) => setProjectDialog(project)}
            onDeleteProject={(project) => {
              if (window.confirm(t('deleteProjectConfirm', { name: project.name }))) {
                void runProjectOperation(() => api.deleteProject(project.id))
              }
            }}
            onEmptyTrash={() => emptyTrash()}
          />
        )}
      </main>

      {(error || notice) && (
        <div className={`toast${error ? ' toast--error' : ''}`} role="status">
          <span>{error ?? notice}</span>
          <button
            className="icon-button icon-button--small"
            type="button"
            aria-label={t('close')}
            onClick={() => {
              setError(null)
              setNotice(null)
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          environment={environment}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => void saveSettings(next)}
          allowBrowse={platform.chooseCliPath}
          onBrowse={() => api.chooseCliPath()}
        />
      )}

      {projectDialog && (
        <ProjectDialog
          initialName={projectDialog === 'new' ? undefined : projectDialog.name}
          busy={busy}
          onClose={() => setProjectDialog(null)}
          onSubmit={(name) => void runProjectOperation(
            () => projectDialog === 'new'
              ? api.createProject(name)
              : api.renameProject(projectDialog.id, name),
            true
          )}
        />
      )}

      {threadProject && (
        <CreateThreadDialog
          project={threadProject}
          busy={busy}
          onClose={() => setThreadProject(null)}
          onSubmit={(name) => void createThread(threadProject, name)}
        />
      )}

      {deleteIds && !platform.taskTrash && (
        <DeleteDialog
          threads={deleteThreads}
          externalProcesses={environment.externalCodexProcesses}
          allowDirectoryTrash={platform.directoryTrash}
          busy={busy}
          onClose={() => setDeleteIds(null)}
          onConfirm={(ids, trashWorkingDirectories) =>
            void runOperation(
              () => api.deleteThreads(ids, { trashWorkingDirectories }),
              true
            )
          }
        />
      )}

      {platform.desktopRecentsRepair && recentsRepairOpen && desktopRecents.state === 'stale' && (
        <RecentsRepairDialog
          status={desktopRecents}
          busy={busy}
          onClose={() => setRecentsRepairOpen(false)}
          onConfirm={() => void repairDesktopRecents()}
        />
      )}
    </div>
  )
}
