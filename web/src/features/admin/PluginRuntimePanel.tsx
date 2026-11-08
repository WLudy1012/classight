import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { pluginsApi } from '@/shared/plugins'
import { isMockApi } from '@/shared/api'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Badge, Button } from '@/shared/ui'

export function PluginRuntimePanel() {
  const en = useTranslation().i18n.language.startsWith('en')
  const q = useQuery({ queryKey: ['admin', 'plugins', 'runtime'], queryFn: pluginsApi.runtime, refetchInterval: () => document.hidden ? false : 3_000 })
  const labels: Record<string, string> = en ? { active: 'Loaded', loaded: 'Loaded', load_failed: 'Load failed', failed: 'Load failed', reload_failed: 'Reload failed', error: 'Reload failed', reloading: 'Reloading', unloaded: 'Unloaded', removed: 'Removed' } : { active: '已加载', loaded: '已加载', load_failed: '加载失败', failed: '加载失败', reload_failed: '重载失败', error: '重载失败', reloading: '重载中', unloaded: '已卸载', removed: '已移除' }
  return <section className="plugin-runtime" aria-label={en ? 'DLL runtime' : 'DLL 运行状态'}>
    <div className="plugin-runtime__head"><div><h2>{en ? 'DLL runtime' : 'DLL 运行状态'}</h2><p>{isMockApi() ? (en ? 'Demo mode does not watch files.' : '演示模式不监视 DLL 文件。') : (en ? 'The daemon watches its plugin directory and reloads changed DLLs.' : 'daemon 自动监视同目录 plugin 文件夹中的 DLL 变化。')}</p></div><Button variant="ghost" size="sm" icon="refresh" loading={q.isFetching} onClick={() => void q.refetch()}>{en ? 'Refresh' : '刷新'}</Button></div>
    {q.isError && <div className="form-error" role="alert">{errorMessage(q.error)}</div>}
    {q.data?.map((item) => <div key={item.fileName} className="plugin-runtime__row">
      <div><strong>{item.fileName}</strong><span className="muted small">{item.pluginIds.join(', ')}{item.version ? ` · ${item.version}` : ''}{item.loadedAt ? ` · ${formatDate(item.loadedAt)}` : ''}</span>{item.error && <p className="plugin-runtime__error" role="status">{item.error}</p>}</div>
      <Badge tone={item.error || ['failed', 'error', 'load_failed', 'reload_failed'].includes(item.state) ? 'danger' : ['active', 'loaded'].includes(item.state) ? 'success' : undefined}>{labels[item.state] ?? item.state}</Badge>
      <span className="muted small">{en ? `${item.reloadCount} reloads` : `重载 ${item.reloadCount} 次`}</span>
    </div>)}
    {q.data?.length === 0 && !isMockApi() && <p className="muted small">{en ? 'No plugin DLL has been discovered. Place plugin packages in the plugin directory.' : '尚未发现插件 DLL，请将插件文件放入 plugin 目录。'}</p>}
  </section>
}
