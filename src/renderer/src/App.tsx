import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Inbox,
  LoaderCircle,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X
} from 'lucide-react'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppSettings,
  BatchOperationResult,
  EnvironmentStatus,
  ThreadRecord
} from '../../shared/contracts'
import { DeleteDialog } from './components/DeleteDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ThreadTable } from './components/ThreadTable'
import {
  DEFAULT_FILTERS,
  filterThreads,
  type AgeFilter,
  type ArchiveFilter,
  type SortMode,
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
  return translate('operationDone', {
    success: result.succeeded.length,
    failed: result.failed.length,
    skipped: result.skipped.length
  })
}

export default function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const booted = useRef(false)
  const [settings, setSettings] = useState<AppSettings>({ locale: 'en', customCliPath: null })
  const [environment, setEnvironment] = useState<EnvironmentStatus>(INITIAL_ENVIRONMENT)
  const [threads, setThreads] = useState<ThreadRecord[]>([])
  const [filters, setFilters] = useState<ThreadFilters>(DEFAULT_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.threadbox.listThreads()
      setThreads(result.threads)
      setEnvironment(result.environment)
      const selectable = new Set(
        result.threads.filter((thread) => thread.status !== 'active').map((thread) => thread.id)
      )
      setSelected((current) => new Set([...current].filter((id) => selectable.has(id))))
    } catch (caught) {
      const status = await window.threadbox.getEnvironmentStatus().catch(() => INITIAL_ENVIRONMENT)
      setEnvironment(status)
      setError(caught instanceof Error ? caught.message : t('unknownError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    void (async () => {
      const currentSettings = await window.threadbox.getSettings()
      setSettings(currentSettings)
      await i18n.changeLanguage(currentSettings.locale)
      await refresh()
    })()
  }, [i18n, refresh])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const visibleThreads = useMemo(() => filterThreads(threads, filters), [threads, filters])
  const selectedThreads = useMemo(
    () => threads.filter((thread) => selected.has(thread.id)),
    [selected, threads]
  )
  const selectableVisible = useMemo(
    () => visibleThreads.filter((thread) => thread.status !== 'active'),
    [visibleThreads]
  )
  const allSelectableSelected =
    selectableVisible.length > 0 && selectableVisible.every((thread) => selected.has(thread.id))
  const someSelectableSelected = selectableVisible.some((thread) => selected.has(thread.id))
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

  const setFilter = <K extends keyof ThreadFilters>(key: K, value: ThreadFilters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const runOperation = useCallback(
    async (operation: () => Promise<BatchOperationResult>, closeDelete = false): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const result = await operation()
        setNotice(operationSummary(result, t))
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

  const toggleThread = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleVisible = (): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelectableSelected) selectableVisible.forEach((thread) => next.delete(thread.id))
      else selectableVisible.forEach((thread) => next.add(thread.id))
      return next
    })
  }

  const saveSettings = async (next: AppSettings): Promise<void> => {
    setBusy(true)
    try {
      const updated = await window.threadbox.updateSettings(next)
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

  const archiveSelected = selectedThreads.filter((thread) => !thread.archived).map((thread) => thread.id)
  const unarchiveSelected = selectedThreads.filter((thread) => thread.archived).map((thread) => thread.id)
  const pinnedSelected = selectedThreads.filter((thread) => thread.pinned).map((thread) => thread.id)
  const unpinnedSelected = selectedThreads.filter((thread) => !thread.pinned).map((thread) => thread.id)
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
            <span className="brand__version">v0.1.0</span>
          </div>
        </div>
        <div className="header-stats" aria-live="polite">
          <span>
            {visibleThreads.length} / {threads.filter((thread) => !thread.internal).length}
          </span>
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
            <label className="compact-check">
              <input
                type="checkbox"
                checked={filters.showInternal}
                onChange={(event) => setFilter('showInternal', event.target.checked)}
              />
              <span>{t('showInternal')}</span>
            </label>
          </section>

          {environment.externalCodexProcesses > 0 && (
            <div className="process-warning">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{t('externalProcesses', { count: environment.externalCodexProcesses })}</span>
            </div>
          )}

          <section className="selection-bar" aria-live="polite">
            {selected.size === 0 ? (
              <span className="selection-placeholder">
                {visibleThreads.length} {t('thread').toLocaleLowerCase()}
              </span>
            ) : (
              <>
                <strong>{t('selected', { count: selected.size })}</strong>
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
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || archiveSelected.length === 0}
                  onClick={() => void runOperation(() => window.threadbox.archiveThreads(archiveSelected))}
                >
                  <Archive size={15} aria-hidden="true" />
                  {t('archive')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busy || unarchiveSelected.length === 0}
                  onClick={() => void runOperation(() => window.threadbox.unarchiveThreads(unarchiveSelected))}
                >
                  <ArchiveRestore size={15} aria-hidden="true" />
                  {t('unarchive')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  title={!environment.capabilities.pinning ? t('pinningUnavailable') : undefined}
                  disabled={busy || !environment.capabilities.pinning || unpinnedSelected.length === 0}
                  onClick={() => void runOperation(() => window.threadbox.setPinned(unpinnedSelected, true))}
                >
                  <Pin size={15} aria-hidden="true" />
                  {t('pin')}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  title={!environment.capabilities.pinning ? t('pinningUnavailable') : undefined}
                  disabled={busy || !environment.capabilities.pinning || pinnedSelected.length === 0}
                  onClick={() => void runOperation(() => window.threadbox.setPinned(pinnedSelected, false))}
                >
                  <PinOff size={15} aria-hidden="true" />
                  {t('unpin')}
                </button>
                <button
                  className="button button--quiet-danger"
                  type="button"
                  disabled={busy || selectedThreads.every((thread) => thread.pinned)}
                  onClick={() => setDeleteIds([...selected])}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {t('delete')}
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
        ) : visibleThreads.length === 0 ? (
          <div className="center-state">
            <Inbox size={30} aria-hidden="true" />
            <h2>{t('noThreadsTitle')}</h2>
            <p>{t('noThreads')}</p>
          </div>
        ) : (
          <ThreadTable
            threads={visibleThreads}
            selected={selected}
            locale={settings.locale}
            allSelectableSelected={allSelectableSelected}
            someSelectableSelected={someSelectableSelected}
            onToggle={toggleThread}
            onToggleVisible={toggleVisible}
            onOpenDirectory={(path) => {
              void window.threadbox.openWorkingDirectory(path).then((message) => message && setError(message))
            }}
            onCopyId={(id) => {
              void window.threadbox.copyThreadId(id).then(() => setNotice(t('copied')))
            }}
            onArchive={(thread) =>
              void runOperation(() =>
                thread.archived
                  ? window.threadbox.unarchiveThreads([thread.id])
                  : window.threadbox.archiveThreads([thread.id])
              )
            }
            onDelete={(thread) => setDeleteIds([thread.id])}
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
          onBrowse={() => window.threadbox.chooseCliPath()}
        />
      )}

      {deleteIds && (
        <DeleteDialog
          threads={deleteThreads}
          externalProcesses={environment.externalCodexProcesses}
          busy={busy}
          onClose={() => setDeleteIds(null)}
          onConfirm={(ids) => void runOperation(() => window.threadbox.deleteThreads(ids), true)}
        />
      )}
    </div>
  )
}
