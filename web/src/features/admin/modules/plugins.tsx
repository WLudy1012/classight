import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { can, useAuth } from '@/features/auth/store'
import { errorMessage } from '@/shared/i18n'
import { pluginsApi, type PluginId } from '@/shared/plugins'
import { Badge, Button, Input, Pagination, Select, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'
import { pluginPresentation } from '../plugin-presentations'
import '../plugin-config'
import '../plugin-config/plugins.css'

const PAGE_SIZE = 20

function PluginsAdmin() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const language = en ? 'en' : 'zh'
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const canWrite = can(useAuth((s) => s.user), 'site.settings.write')
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'plugins'], queryFn: pluginsApi.list })
  const update = useMutation({ mutationFn: ({ id, enabled }: { id: PluginId; enabled: boolean }) => pluginsApi.set(id, enabled), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'plugins'] }); void qc.invalidateQueries({ queryKey: ['plugins'] }) }, onError: (e) => toast.error(errorMessage(e)) })
  const selected = params.get('config')
  const all = useMemo(() => q.data ?? [], [q.data])
  const enabledCount = all.filter((plugin) => plugin.enabled).length
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return all.filter((plugin) => {
      if (filter === 'enabled' && !plugin.enabled || filter === 'disabled' && plugin.enabled || filter === 'configurable' && !pluginPresentation(plugin.id)?.Settings) return false
      const details = pluginPresentation(plugin.id)
      return !term || [plugin.id, details?.name.zh, details?.name.en, details?.description.zh, details?.description.en, ...(plugin.dependencies ?? [])].some((value) => value?.toLocaleLowerCase().includes(term))
    }).sort((a, b) => (pluginPresentation(a.id)?.name[language] ?? a.id).localeCompare(pluginPresentation(b.id)?.name[language] ?? b.id, language))
  }, [all, search, filter, language])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(matches.length / PAGE_SIZE)))
  const visible = matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const SelectedConfig = selected && all.some((plugin) => plugin.id === selected) && !visible.some((plugin) => plugin.id === selected) ? pluginPresentation(selected)?.Settings : undefined
  const selectConfig = (id: string) => {
    const next = new URLSearchParams(params)
    if (selected === id) next.delete('config')
    else next.set('config', id)
    setParams(next)
  }

  return <div className="page plugins-admin">
    <PageHeader title={en ? 'Plugin management' : '插件管理'} sub={en ? 'Find, configure and manage installed plugins.' : '查找、配置和管理已安装的插件。'} />
    <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={4}>
      <div className="plugin-toolbar">
        <div className="plugin-toolbar__summary"><strong className="num">{all.length}</strong><span>{en ? 'installed' : '个已安装'}</span><span className="plugin-toolbar__divider" aria-hidden="true" /><strong className="num">{enabledCount}</strong><span>{en ? 'enabled' : '个已启用'}</span></div>
        <div className="plugin-toolbar__controls">
          <Input type="search" aria-label={en ? 'Search plugins' : '搜索插件'} placeholder={en ? 'Search name, ID or description' : '搜索名称、ID 或描述'} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Select aria-label={en ? 'Filter plugins' : '筛选插件'} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1) }}>
            <option value="all">{en ? 'All plugins' : '全部插件'}</option>
            <option value="enabled">{en ? 'Enabled' : '已启用'}</option>
            <option value="disabled">{en ? 'Disabled' : '已停用'}</option>
            <option value="configurable">{en ? 'Configurable' : '可配置'}</option>
          </Select>
        </div>
      </div>
      <div className="plugin-results" aria-live="polite">{en ? `${matches.length} results` : `找到 ${matches.length} 个插件`}</div>
      <div className="plugin-list">
        {visible.map((plugin) => {
          const details = pluginPresentation(plugin.id)
          const Config = selected === plugin.id ? details?.Settings : undefined
          return <section key={plugin.id} className="plugin-item">
            <div className="plugin-row">
              <div className="plugin-row__text"><strong>{details?.name[language] ?? plugin.id}</strong><div className="muted small">{details?.description[language]}</div>{!!plugin.dependencies?.length && <div className="muted small">{en ? 'Requires: ' : '依赖：'}{plugin.dependencies.map((id) => pluginPresentation(id)?.name[language] ?? id).join(', ')}</div>}</div>
              <Badge tone={plugin.enabled ? 'success' : undefined}>{plugin.enabled ? (en ? 'Enabled' : '已启用') : (en ? 'Disabled' : '已停用')}</Badge>
              {details?.Settings && <Button size="sm" variant="secondary" aria-expanded={selected === plugin.id} onClick={() => selectConfig(plugin.id)}>{selected === plugin.id ? (en ? 'Close' : '收起') : (en ? 'Configure' : '配置')}</Button>}
              {canWrite && <Button size="sm" variant="secondary" loading={update.isPending && update.variables?.id === plugin.id} disabled={update.isPending} onClick={() => update.mutate({ id: plugin.id, enabled: !plugin.enabled })}>{plugin.enabled ? (en ? 'Disable' : '停用') : (en ? 'Enable' : '启用')}</Button>}
            </div>
            {Config && <div className="plugin-item__settings"><Config readOnly={!canWrite} /></div>}
          </section>
        })}
        {!matches.length && <div className="plugin-empty">{all.length ? (en ? 'No plugins match these filters.' : '没有找到符合条件的插件。') : (en ? 'No plugins are installed.' : '尚未安装插件。')}{(search || filter !== 'all') && <Button size="sm" variant="ghost" onClick={() => { setSearch(''); setFilter('all'); setPage(1) }}>{en ? 'Clear filters' : '清除筛选'}</Button>}</div>}
      </div>
      {matches.length > PAGE_SIZE && <Pagination page={currentPage} pageSize={PAGE_SIZE} total={matches.length} onPage={setPage} />}
      {SelectedConfig && selected && <section className="plugin-item__settings"><div className="plugin-settings-heading"><strong>{pluginPresentation(selected)?.name[language] ?? selected}</strong><Button size="sm" variant="ghost" onClick={() => selectConfig(selected)}>{en ? 'Close' : '收起'}</Button></div><SelectedConfig readOnly={!canWrite} /></section>}
    </QueryBoundary>
  </div>
}

registerAdminModule({ id: 'plugins', group: 'site', order: 31, label: 'admin.nav.plugins', icon: 'grid', path: 'plugins', permission: 'site.settings.read', element: PluginsAdmin })
