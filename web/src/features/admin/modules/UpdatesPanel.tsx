import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type UpdateStatus } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { errorMessage } from '@/shared/i18n'
import { Badge, Button, toast } from '@/shared/ui'
import { QueryBoundary } from '../common'
import './updates.css'

const queryKey = ['admin', 'updates']
const working = new Set(['queued', 'checking', 'downloading', 'installing'])
const labels = {
  zh: { unsupported: '当前运行方式不支持', disabled: '已关闭', idle: '等待检查', queued: '已加入检查队列', checking: '正在检查', current: '当前已是最新稳定版', downloading: '正在下载', installing: '正在准备安装', ready: '等待重启生效', error: '更新失败，将自动重试' },
  en: { unsupported: 'Unavailable for this installation', disabled: 'Disabled', idle: 'Waiting to check', queued: 'Check queued', checking: 'Checking', current: 'Latest stable version installed', downloading: 'Downloading', installing: 'Preparing installation', ready: 'Restart required', error: 'Update failed; retry scheduled' },
}
const failures: Record<string, [string, string]> = {
  timeout: ['下载超时，请检查网络连接。', 'The download timed out. Check the network connection.'],
  network: ['无法连接 GitHub 或请求被限流，请稍后重试。', 'GitHub is unavailable or rate limiting requests. Try again later.'],
  verification: ['更新文件校验失败，当前程序继续运行。', 'The update failed verification. The current application keeps running.'],
  filesystem: ['无法写入更新文件，请检查安装目录权限和剩余空间。', 'Cannot write update files. Check installation directory permissions and free space.'],
  install: ['无法准备安装，请查看服务日志后重试。', 'Cannot prepare installation. Check the service logs and retry.'],
}

export function UpdatesPanel() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const user = useAuth(s => s.user)
  const client = useQueryClient()
  const q = useQuery({ queryKey, queryFn: adminApi.updateStatus,
    refetchInterval: query => working.has(query.state.data?.phase ?? '') ? 2000 : 15000 })
  const check = useMutation({ mutationFn: adminApi.checkUpdate,
    onSuccess: status => client.setQueryData<UpdateStatus>(queryKey, status),
    onError: error => { toast.error(errorMessage(error)); void q.refetch() } })
  const s = q.data
  const phase = s && (!s.supported ? 'unsupported' : !s.enabled ? 'disabled' : s.phase)
  const date = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : '—'
  const failure = s?.errorCode ? failures[s.errorCode] : undefined

  return (
    <section className="updates" aria-labelledby="updates-title">
      <div className="updates__heading">
        <h2 id="updates-title">{en ? 'Application updates' : '程序更新'}</h2>
        {can(user, 'system.manage') && <Button variant="secondary" icon="refresh"
          loading={check.isPending || !!s && working.has(s.phase)}
          disabled={!s?.supported || !s.enabled || s.restartRequired || !!s && working.has(s.phase)}
          onClick={() => check.mutate()}>{en ? 'Check for updates' : '检查更新'}</Button>}
      </div>
      <p className="muted">{en ? 'Downloads stable releases from ' : '从 GitHub 下载稳定版本：'}
        <a href="https://github.com/WLudy1012/classight/releases" target="_blank" rel="noreferrer">WLudy1012/classight</a>
      </p>
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {s && phase && <>
          <dl className="updates__details">
            <div className="statusrow"><dt>{en ? 'Status' : '更新状态'}</dt><dd><Badge tone={phase === 'error' ? 'danger' : phase === 'current' ? 'success' : undefined}>{labels[en ? 'en' : 'zh'][phase]}</Badge></dd></div>
            <div className="statusrow"><dt>{en ? 'Running version' : '运行版本'}</dt><dd className="num">{s.currentVersion}</dd></div>
            <div className="statusrow"><dt>{en ? 'Available version' : '发现的新版本'}</dt><dd className="num">{s.latestVersion ?? '—'}</dd></div>
            <div className="statusrow"><dt>{en ? 'Last check' : '上次检查'}</dt><dd>{date(s.lastCheckedAt)}</dd></div>
            {s.nextCheckAt && <div className="statusrow"><dt>{en ? 'Next check' : '下次检查'}</dt><dd>{date(s.nextCheckAt)}</dd></div>}
          </dl>
          {s.phase === 'downloading' && <div className="updates__progress">
            <progress aria-label={en ? 'Download progress' : '下载进度'} value={s.downloadedBytes} max={Math.max(1, s.totalBytes)} />
            <span className="num">{(s.downloadedBytes / 1048576).toFixed(1)} / {(s.totalBytes / 1048576).toFixed(1)} MB</span>
          </div>}
          {failure && <p role="alert">{failure[en ? 1 : 0]}</p>}
          {s.restartRequired && <p role="status">{s.platform === 'windows'
            ? en ? 'The update will replace the application after it exits. Start it again to use the new version.' : '更新已准备好。退出程序后会自动替换，再启动即可使用新版本。'
            : en ? 'The update is installed on disk. Restart the service to use the new version.' : '更新已安装到磁盘，重启服务即可使用新版本。'}</p>}
          {s.backupAvailable && <p className="muted">{en ? 'The previous executable is backed up. This backup does not include the database.' : '已保留旧程序备份，备份不包含数据库。'}</p>}
          {!s.supported && <p className="muted">{en ? 'Use the Windows x64 or Linux x64 daemon release to enable automatic updates.' : '请使用 Windows x64 或 Linux x64 的 daemon 发布版启用自动更新。'}</p>}
          {!s.enabled && <p className="muted">{en ? 'Set Updates.Enabled to true in config/appsettings.json and restart to enable updates.' : '如需开启，在 config/appsettings.json 中将 Updates.Enabled 设为 true，然后重启。'}</p>}
        </>}
      </QueryBoundary>
    </section>
  )
}
