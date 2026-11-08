import { createElement, isValidElement, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { generatePath, Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NotFoundPage } from '@/app/NotFound'
import { RequireAuth } from '@/features/auth/guards'
import { can, useAuth } from '@/features/auth/store'
import { ProfilePage } from '@/features/console/ProfilePage'
import { SecurityPage } from '@/features/console/SecurityPage'
import { useDocumentTitle } from '@/shared/hooks'
import { meApi } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Badge, Button, Icon, Input, Skeleton, StateView } from '@/shared/ui'
import { usePluginStates } from '@/shared/plugins'
import { CENTER_PATH } from './paths'
import { type ClassCenterPlugin } from './registry'
import { useClassCenterPlugins } from './runtime'
import './plugins'
import './class-center.css'

export { getClassCenterPlugins } from './registry'

export function LegacyPluginRoute({ path }: { path: string }) {
  const params = useParams()
  const location = useLocation()
  return <Navigate to={`${generatePath(`${CENTER_PATH}/${path}`, params)}${location.search}${location.hash}`} replace />
}

function CenterIndex({ plugins }: { plugins: ClassCenterPlugin[] }) {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const user = useAuth((state) => state.user)
  const [search, setSearch] = useState('')
  const term = search.trim().toLocaleLowerCase()
  const tools = plugins.filter((plugin) => plugin.category !== 'account')
  const visible = tools.filter((plugin) => !term || [plugin.id, t(plugin.label), t(plugin.description)].some((value) => value.toLocaleLowerCase().includes(term)))
  useDocumentTitle(en ? 'Workspace' : '班级工作台')
  return (
    <div className="center page">
      <header className="center__heading">
        <div>
          <h1 className="page__title">{t('center.title')}</h1>
          <p className="page__sub">{en ? `Welcome back, ${user?.displayName ?? ''}.` : `${user?.displayName ?? ''}，欢迎回来。`}</p>
        </div>
        <Link to="/center/account" className="btn btn-secondary btn-sm"><Icon name="user" />{en ? 'Account settings' : '账户设置'}</Link>
      </header>
      <section className="center__tools" aria-labelledby="center-tools">
        <div className="center__toolbar">
          <h2 id="center-tools">{en ? 'Class tools' : '班级工具'}</h2>
          <Input type="search" aria-label={en ? 'Search tools' : '搜索工具'} placeholder={en ? 'Search tools' : '搜索工具'} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <ul className="center__list">
          {visible.map((plugin) => (
            <li key={plugin.id}>
              <Link to={`${CENTER_PATH}/${plugin.path}`}>
                <span className="center__tool-icon"><Icon name={plugin.icon} size={22} /></span>
                <span className="center__tool-copy"><strong>{t(plugin.label)}</strong><small>{t(plugin.description)}</small></span>
                <span className="center__tool-open">{en ? 'Open' : '打开'}<Icon name="arrowRight" size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>
        {!visible.length && <StateView icon="search" title={term ? (en ? 'No matching tools' : '没有找到相关工具') : t('center.empty')} action={term ? <Button variant="secondary" onClick={() => setSearch('')}>{en ? 'Clear search' : '清除搜索'}</Button> : undefined} />}
      </section>
    </div>
  )
}

function AccountSettings({ plugins, children }: { plugins: ClassCenterPlugin[]; children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const user = useAuth((state) => state.user)
  const overview = useQuery({ queryKey: ['me', 'console'], queryFn: meApi.console })
  useDocumentTitle(en ? 'Account settings' : '账户设置')
  return (
    <div className="account-settings page">
      <header><h1 className="page__title">{en ? 'Account settings' : '账户设置'}</h1><p className="page__sub">{en ? 'Manage your profile, sign-in security and permissions.' : '在同一处管理个人资料、登录安全和账户权限。'}</p></header>
      <div className="account-settings__identity">
        <div>{user?.roles.map((role) => <Badge key={role}>{role}</Badge>)}</div>
        <div><Icon name="users" size={16} /><span>{t('console.linkedMember')}：{overview.isPending ? t('common.loading') : overview.isError ? <Button size="sm" variant="ghost" onClick={() => void overview.refetch()}>{t('common.retry')}</Button> : overview.data.linkedMember?.displayName ?? t('console.notLinked')}</span></div>
      </div>
      <nav className="account-settings__tabs" aria-label={en ? 'Account settings' : '账户设置'}>
        <NavLink to="/center/account" end><Icon name="user" size={16} />{t('console.profile')}</NavLink>
        <NavLink to="/center/account/security"><Icon name="shield" size={16} />{t('console.security')}</NavLink>
        {plugins.filter((plugin) => plugin.category === 'account').map((plugin) => <NavLink key={plugin.id} to={`${CENTER_PATH}/${plugin.path}`}><Icon name={plugin.icon} size={16} />{t(plugin.label)}</NavLink>)}
      </nav>
      <div className="account-settings__content">{children}</div>
    </div>
  )
}

export default function ClassCenter() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const states = usePluginStates()
  const discovered = useClassCenterPlugins()
  if (states.isPending || discovered.catalog.isPending) return <div className="page center__loading" aria-busy="true"><Skeleton w={280} h={36} /><Skeleton w="65%" h={20} /><Skeleton h={200} /></div>
  if (states.isError || discovered.catalog.isError) return <StateView icon="alert" title={t('common.error')} body={errorMessage(states.error ?? discovered.catalog.error)} action={<Button onClick={() => { void states.refetch(); void discovered.catalog.refetch() }}>{t('common.retry')}</Button>} />
  const plugins = discovered.plugins.filter((plugin) => states.data[plugin.id] && can(user, plugin.permission))
  const account = (children: ReactNode) => <AccountSettings plugins={plugins}>{children}</AccountSettings>
  return (
    <Routes>
      <Route index element={<CenterIndex plugins={plugins} />} />
      <Route path="account" element={account(<ProfilePage embedded />)} />
      <Route path="account/security" element={account(<SecurityPage embedded />)} />
      {discovered.plugins.filter((plugin) => states.data[plugin.id]).flatMap((plugin) => plugin.routes.map((route) => {
        const content = isValidElement(route.element) ? route.element : createElement(route.element)
        return <Route key={`${plugin.id}:${route.path}`} path={route.path} element={<RequireAuth permission={plugin.permission}>{plugin.category === 'account' ? account(content) : content}</RequireAuth>} />
      }))}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
