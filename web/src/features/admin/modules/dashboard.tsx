import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/shared/api'
import { formatDate } from '@/shared/i18n'
import { can, useAuth } from '@/features/auth/store'
import { Icon } from '@/shared/ui'
import { PageHeader, QueryBoundary, useActionLabel } from '../common'
import { getAdminModules, registerAdminModule } from '../registry'

const GROUPS = ['class', 'people', 'site'] as const
const DESCRIPTIONS: Record<string, [string, string]> = {
  'class-profile': ['班级简介、口号与创班日期', 'Class introduction, motto and founding date'],
  members: ['成员档案与账号关联', 'Member profiles and linked accounts'],
  timeline: ['发布和维护班级记录', 'Publish and maintain class milestones'],
  users: ['账号资料与访问状态', 'Accounts, profiles and access status'],
  roles: ['分配角色与操作权限', 'Assign roles and permissions'],
  invites: ['管理新成员的加入方式', 'Manage how new members join'],
  settings: ['站点名称、外观与访问规则', 'Site identity, appearance and access rules'],
  plugins: ['启停和配置班级工具', 'Enable and configure class tools'],
  audit: ['查看后台操作记录', 'Review administrative changes'],
  system: ['服务状态与缓存维护', 'Service health and cache maintenance'],
}

function Dashboard() {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const actionLabel = useActionLabel()
  const user = useAuth((state) => state.user)
  const canAudit = can(user, 'audit.read')
  const modules = getAdminModules().filter((module) => module.group !== 'overview' && can(user, module.permission))
  const audit = useQuery({
    queryKey: ['admin', 'dashboard', 'audit'],
    queryFn: () => adminApi.auditLogs({ pageSize: 5 }),
    enabled: canAudit,
  })

  return (
    <div className="page admin-overview">
      <PageHeader
        title={en ? 'Administration' : '管理总览'}
        sub={en ? 'Manage class content, member access and site tools in one place.' : '在这里维护班级内容、成员访问和站点工具。'}
      />
      <div className="admin-overview__groups">
        {GROUPS.map((group) => {
          const items = modules.filter((module) => module.group === group)
          if (!items.length) return null
          return (
            <section key={group} className="admin-overview__group" aria-labelledby={`manage-${group}`}>
              <h2 id={`manage-${group}`}>{t(`admin.nav.group_${group}`)}</h2>
              <ul>
                {items.map((module) => (
                  <li key={module.id}>
                    <Link to={`/admin/${module.path}`}>
                      <Icon name={module.icon} />
                      <span><strong>{t(module.label)}</strong><small>{DESCRIPTIONS[module.id]?.[en ? 1 : 0]}</small></span>
                      <Icon name="arrowRight" size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {canAudit && (
        <section className="page__section" aria-labelledby="d-recent">
          <div className="row-between">
            <h2 id="d-recent" className="page__h">{t('admin.dashboard.recent')}</h2>
            <Link to="/admin/audit" className="admin-text-link">{en ? 'View all activity' : '查看全部记录'}<Icon name="arrowRight" size={14} /></Link>
          </div>
          <QueryBoundary pending={audit.isPending} error={audit.error} onRetry={() => void audit.refetch()} rows={3}>
            {audit.data?.items.length ? (
              <ul className="feed">
                {audit.data.items.map((item) => (
                  <li key={item.id}>
                    <time className="num" dateTime={item.at}>{formatDate(item.at, { dateStyle: 'short', timeStyle: 'short' })}</time>
                    <span><strong>{item.actor}</strong> · {actionLabel(item.action)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">{t('admin.dashboard.noRecent')}</p>}
          </QueryBoundary>
        </section>
      )}
    </div>
  )
}

registerAdminModule({ id: 'dashboard', group: 'overview', order: 0, label: 'admin.nav.dashboard', icon: 'home', path: '', element: Dashboard })
