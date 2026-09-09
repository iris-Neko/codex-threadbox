import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderKanban, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadGroup } from '../../../packages/core/src/thread-utils'
import type { desktopNavigation } from './desktop-model'

interface Props {
  navigation: ReturnType<typeof desktopNavigation>
  scope: string
  count: number
  projectState?: 'loading' | 'ready' | 'error'
  onScope(scope: string): void
  onTask(id: string): void
}

export function DesktopNavigation({ navigation, scope, count, projectState = 'ready', onScope, onTask }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const text = (en: string, cn: string): string => i18n.language.startsWith('zh') ? cn : en
  const toggle = (id: string): void => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const groupButton = (group: ThreadGroup, project: boolean): React.JSX.Element => (
    <button className={scope === group.id ? 'is-current' : ''} aria-label={group.name} aria-current={scope === group.id ? 'page' : undefined}
      title={project ? `${group.name}\n${group.projectId}\n${group.directories.join('\n')}` : group.directories.join('\n')}
      onClick={() => { onScope(group.id); if (project) setExpanded((current) => new Set(current).add(group.id)) }}>
      {project ? <FolderKanban size={16} /> : <Folder size={16} />}
      <span>{group.name}</span><small>{group.threads.length}</small>
    </button>
  )
  return <nav aria-label={text('Task navigation', '任务导航')}>
    <button className={scope === 'all' ? 'is-current' : ''} aria-current={scope === 'all' ? 'page' : undefined} onClick={() => onScope('all')}>
      <Inbox size={17} /><span>{text('All tasks', '全部任务')}</span><small>{count}</small>
    </button>
    <section aria-label={text('Projects', '项目')}>
      <h2>{text('Projects', '项目')}</h2>
      {navigation.projects.length === 0 && <p className="desktop-nav-empty">{projectState === 'loading' ? text('Loading projects...', '正在读取项目…') : projectState === 'error' ? text('Projects unavailable', '项目暂不可用') : text('No projects', '暂无项目')}</p>}
      {navigation.projects.map((group) => <div key={group.id}>
        <div className="desktop-project-heading">
          <button className="desktop-project-toggle" aria-expanded={expanded.has(group.id)}
            aria-label={text(`${expanded.has(group.id) ? 'Collapse' : 'Expand'} project ${group.name}`, `${expanded.has(group.id) ? '收起' : '展开'}项目 ${group.name}`)}
            onClick={() => toggle(group.id)}>
            {expanded.has(group.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {groupButton(group, true)}
        </div>
        {expanded.has(group.id) && <div className="desktop-project-tasks">
          {group.threads.toSorted((a, b) => b.updatedAt - a.updatedAt).map((thread) => <button key={thread.id}
            className={scope === `task:${thread.id}` ? 'is-current' : ''}
            aria-current={scope === `task:${thread.id}` ? 'page' : undefined}
            title={thread.title} onClick={() => onTask(thread.id)}><span>{thread.title}</span></button>)}
        </div>}
      </div>)}
    </section>
    <section aria-label={text('Directories', '目录')}>
      <h2>{text('Directories', '目录')}</h2>
      {navigation.directories.map((group) => <div key={group.id}>{groupButton(group, false)}</div>)}
    </section>
    {navigation.standalone.map((group) => <section key={group.id} aria-label={t('standaloneTasks')}>
      <h2>{t('standaloneTasks')}</h2>
      <button className={scope === group.id ? 'is-current' : ''} onClick={() => onScope(group.id)}>
        <Inbox size={16} /><span>{t('standaloneTasks')}</span><small>{group.threads.length}</small>
      </button>
    </section>)}
  </nav>
}
