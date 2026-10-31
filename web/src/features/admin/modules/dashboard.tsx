import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/shared/api'
import { formatDate } from '@/shared/i18n'
import { can, useAuth } from '@/features/auth/store'
import { PageHeader, QueryBoundary, useActionLabel } from '../common'
import { registerAdminModule } from '../registry'

function Dashboard() {
  const { t } = useTranslation()
  const actionLabel = useActionLabel()
  const user = useAuth((s) => s.user)
  const canUsers = can(user, 'users.read')
  const canAudit = can(user, 'audit.read')
  const canMembers = can(user, 'class.members.manage')
  const canTimeline = can(user, 'class.timeline.manage')

  const q = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const [members, users, timeline, audit] = await Promise.all([
        canMembers ? adminApi.members({ pageSize: 1 }) : null,
        canUsers ? adminApi.users({ pageSize: 1 }) : null,
        canTimeline ? adminApi.timeline({ pageSize: 1 }) : null,
        canAudit ? adminApi.auditLogs({ pageSize: 8 }) : null,
      ])
      return { members: members?.total, users: users?.total, events: timeline?.total, audit: audit?.items }
    },
  })

  return (
    <div className="page">
      <PageHeader title={t('admin.dashboard.title')} sub={t('admin.dashboard.sub')} />
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {q.data && (
          <>
            <dl style={{ margin: 0, maxWidth: 420, borderTop: '1px solid var(--line)' }}>
              {q.data.members !== undefined && (
                <div className="statusrow">
                  <dt>{t('admin.dashboard.members')}</dt>
                  <dd className="num">{q.data.members}</dd>
                </div>
              )}
              {q.data.users !== undefined && (
                <div className="statusrow">
                  <dt>{t('admin.dashboard.users')}</dt>
                  <dd className="num">{q.data.users}</dd>
                </div>
              )}
              {q.data.events !== undefined && (
                <div className="statusrow">
                  <dt>{t('admin.dashboard.events')}</dt>
                  <dd className="num">{q.data.events}</dd>
                </div>
              )}
            </dl>
            {q.data.audit && (
              <section className="page__section" aria-labelledby="d-recent">
                <h2 id="d-recent" className="page__h">
                  {t('admin.dashboard.recent')}
                </h2>
                {q.data.audit.length === 0 ? (
                  <p className="muted">{t('admin.dashboard.noRecent')}</p>
                ) : (
                  <ul className="feed">
                    {q.data.audit.map((a) => (
                      <li key={a.id}>
                        <time className="num" dateTime={a.at}>
                          {formatDate(a.at, { dateStyle: 'short', timeStyle: 'short' })}
                        </time>
                        <span>
                          <strong>{a.actor}</strong> · {actionLabel(a.action)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </QueryBoundary>
    </div>
  )
}

registerAdminModule({ id: 'dashboard', group: 'overview', order: 0, label: 'admin.nav.dashboard', icon: 'home', path: '', element: Dashboard })
