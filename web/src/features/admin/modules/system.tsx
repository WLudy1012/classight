import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { errorMessage } from '@/shared/i18n'
import { Badge, Button, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

function uptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(' ')
}

function SystemAdmin() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const q = useQuery({ queryKey: ['admin', 'system'], queryFn: adminApi.systemStatus, refetchInterval: 15_000 })
  const clear = useMutation({
    mutationFn: adminApi.clearCache,
    onSuccess: () => toast.success(t('admin.system.cacheCleared')),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const s = q.data

  const health = (enabled: boolean, healthy: boolean) =>
    !enabled ? (
      <Badge>{t('admin.system.notEnabled')}</Badge>
    ) : healthy ? (
      <Badge tone="success">{t('admin.system.healthy')}</Badge>
    ) : (
      <Badge tone="danger">{t('admin.system.unhealthy')}</Badge>
    )

  return (
    <div className="page">
      <PageHeader
        title={t('admin.system.title')}
        sub={t('admin.system.mockNote')}
        actions={
          can(user, 'system.manage') && (
            <Button icon="refresh" loading={clear.isPending} onClick={() => clear.mutate()}>
              {t('admin.system.clearCache')}
            </Button>
          )
        }
      />
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={5}>
        {s && (
          <dl style={{ margin: 0, maxWidth: 640, borderTop: '1px solid var(--line)' }}>
            <div className="statusrow">
              <dt>{t('admin.system.version')}</dt>
              <dd className="num">{s.version}</dd>
            </div>
            <div className="statusrow">
              <dt>{t('admin.system.runtime')}</dt>
              <dd>{s.runtime}</dd>
            </div>
            <div className="statusrow">
              <dt>{t('admin.system.uptime')}</dt>
              <dd className="num">{uptime(s.uptimeSeconds)}</dd>
            </div>
            <div className="statusrow">
              <dt>{t('admin.system.database')}</dt>
              <dd>
                {s.database.provider} {health(true, s.database.healthy)} <span className="muted small mono">{s.database.migrationVersion}</span>
              </dd>
            </div>
            <div className="statusrow">
              <dt>{t('admin.system.mongo')}</dt>
              <dd>{health(s.mongo.enabled, s.mongo.healthy)}</dd>
            </div>
            <div className="statusrow">
              <dt>{t('admin.system.redis')}</dt>
              <dd>{health(s.redis.enabled, s.redis.healthy)}</dd>
            </div>
          </dl>
        )}
      </QueryBoundary>
    </div>
  )
}

registerAdminModule({
  id: 'system',
  group: 'site',
  order: 32,
  label: 'admin.nav.system',
  icon: 'server',
  path: 'system',
  permission: 'system.read',
  element: SystemAdmin,
})
