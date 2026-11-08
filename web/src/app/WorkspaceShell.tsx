import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { can, useAuth } from '@/features/auth/store'
import { useClassCenterPlugins } from '@/features/class-center/runtime'
import '@/features/class-center/plugins'
import { getAdminModules } from '@/features/admin/registry'
import '@/features/admin/modules'
import { useMediaQuery } from '@/shared/hooks'
import { setLanguage } from '@/shared/i18n'
import { usePluginStates } from '@/shared/plugins'
import { useClassName, useSite } from '@/shared/site'
import { Avatar, Button, Icon, Input } from '@/shared/ui'
import { authApi } from '@/shared/api'
import './workspace.css'

export default function WorkspaceShell({ children, mode = 'workspace' }: { children: ReactNode; mode?: 'workspace' | 'admin' }) {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const text = (zh: string, english: string) => en ? english : zh
  const user = useAuth((state) => state.user)
  const logout = useAuth((state) => state.logout)
  const site = useSite()
  const name = useClassName(site.data)
  const states = usePluginStates()
  const discovered = useClassCenterPlugins()
  const location = useLocation()
  const navigate = useNavigate()
  const mobile = useMediaQuery('(max-width: 900px)')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const side = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const adminModules = getAdminModules()
  const canManage = adminModules.some((item) => item.group !== 'overview' && can(user, item.permission))
  const admin = canManage ? adminModules.filter((item) => can(user, item.permission)) : []
  const availablePlugins = discovered.plugins.filter((item) => states.data?.[item.id] && can(user, item.permission))
  const plugins = availablePlugins.filter((item) => item.category !== 'account')
  const activePlugin = availablePlugins.find((item) => location.pathname.startsWith(`/center/${item.path}`))
  const term = search.trim().toLocaleLowerCase()
  const matches = (label: string, id: string) => !term || `${t(label)} ${id}`.toLocaleLowerCase().includes(term)
  const title = mode === 'admin'
    ? t(admin.find((item) => location.pathname === `/admin/${item.path}` || item.path === '' && location.pathname === '/admin')?.label ?? 'admin.title')
    : location.pathname.startsWith('/center/account') || activePlugin?.category === 'account'
      ? text('账户设置', 'Account settings')
      : activePlugin ? t(activePlugin.label) : text('概览', 'Overview')

  useEffect(() => { setOpen(false); setSearch('') }, [location.pathname])
  useEffect(() => {
    if (!discovered.catalog.data || !user) return
    let current = true
    const refreshPermissions = () => void authApi.me().then((fresh) => {
      if (current && useAuth.getState().user?.id === fresh.id) useAuth.getState().setUser(fresh)
    }).catch(() => {})
    refreshPermissions()
    const retry = window.setTimeout(refreshPermissions, 1_500)
    return () => { current = false; window.clearTimeout(retry) }
  }, [discovered.catalog.data, user?.id])
  useEffect(() => {
    if (!mobile || !open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const elements = () => [...side.current!.querySelectorAll<HTMLElement>('a, button, input')].filter((item) => !item.hasAttribute('disabled'))
    elements()[0]?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); menu.current?.focus() }
      if (event.key !== 'Tab') return
      const items = elements()
      const first = items[0]
      const last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', keydown) }
  }, [mobile, open])

  if (!user) return null
  return <div className="workspace">
    <a href="#workspace-main" className="workspace__skip">{text('跳到内容', 'Skip to content')}</a>
    {mobile && open && <button className="workspace__veil" tabIndex={-1} aria-label={text('关闭导航', 'Close navigation')} onClick={() => { setOpen(false); menu.current?.focus() }} />}
    <aside ref={side} id="workspace-navigation" className="workspace__side" data-open={open} inert={mobile && !open} role={mobile && open ? 'dialog' : undefined} aria-modal={mobile && open || undefined} aria-label={text('工作台导航', 'Workspace navigation')}>
      <div className="workspace__brand-row"><Link to="/center" className="workspace__brand"><span className="shell__mark" aria-hidden="true" /><span>{name}</span></Link>{mobile && <Button variant="ghost" size="sm" icon="close" iconOnly aria-label={text('关闭导航', 'Close navigation')} onClick={() => { setOpen(false); menu.current?.focus() }} />}</div>
      <div className="workspace__switch" aria-label={text('切换区域', 'Switch area')}><NavLink to="/center" className={() => mode === 'workspace' ? 'active' : ''}>{text('工作台', 'Workspace')}</NavLink>{admin.length > 0 && <NavLink to="/admin" className={() => mode === 'admin' ? 'active' : ''}>{text('管理', 'Manage')}</NavLink>}</div>
      {(mode === 'admin' || plugins.length > 8) && <div className="workspace__search"><Icon name="search" size={16} /><Input type="search" value={search} placeholder={text('查找功能', 'Find a page')} aria-label={text('查找导航功能', 'Search navigation')} onChange={(event) => setSearch(event.target.value)} /></div>}
      <nav className="workspace__nav" aria-label={mode === 'admin' ? t('admin.title') : text('班级工作台', 'Class workspace')}>
        {mode === 'workspace' ? <>
          <NavLink to="/center" end><Icon name="home" /><span>{text('工作台概览', 'Overview')}</span></NavLink>
          <div className="workspace__group">{text('班级应用', 'Class apps')}</div>
          {plugins.filter((item) => matches(item.label, item.id)).map((item) => <NavLink key={item.id} to={`/center/${item.path}`}><Icon name={item.icon} /><span>{t(item.label)}</span></NavLink>)}
          {states.isPending && <span className="workspace__nav-note">{text('正在加载应用…', 'Loading apps…')}</span>}
          {states.isError && <button className="workspace__nav-retry" onClick={() => void states.refetch()}><Icon name="refresh" /><span>{text('重新加载应用', 'Reload apps')}</span></button>}
          {!states.isPending && !states.isError && !plugins.length && <span className="workspace__nav-note">{text('暂无启用的应用', 'No apps enabled')}</span>}
          <div className="workspace__group">{text('班级', 'Class')}</div>
          <Link to="/class"><Icon name="users" /><span>{t('console.classInfo')}</span><Icon name="externalLink" size={13} /></Link>
        </> : <>
          {(['overview', 'class', 'people', 'site'] as const).map((group) => {
            const items = admin.filter((item) => item.group === group && matches(item.label, item.id))
            return items.length > 0 && <div key={group} className="workspace__nav-section">{group !== 'overview' && <div className="workspace__group">{t(`admin.nav.group_${group}`)}</div>}{items.map((item) => <NavLink key={item.id} to={item.path ? `/admin/${item.path}` : '/admin'} end={!item.path}><Icon name={item.icon} /><span>{t(item.label)}</span></NavLink>)}</div>
          })}
          {term && !admin.some((item) => matches(item.label, item.id)) && <span className="workspace__nav-note">{text('没有找到功能', 'No matching pages')}</span>}
        </>}
      </nav>
      <div className="workspace__side-bottom"><NavLink to="/center/account" className={location.pathname === '/center/identity' ? 'active' : undefined}><Avatar name={user.displayName} src={user.avatarUrl} size={32} /><span><strong>{user.displayName}</strong><small>{text('账户设置', 'Account settings')}</small></span><Icon name="chevronRight" size={15} /></NavLink><Link to="/"><Icon name="arrowLeft" /><span>{text('返回网站首页', 'Website home')}</span></Link></div>
    </aside>
    <div className="workspace__body" inert={mobile && open}>
      <header className="workspace__header"><div className="workspace__context"><Button ref={menu} className="workspace__menu" variant="ghost" iconOnly icon="menu" aria-label={text('打开导航', 'Open navigation')} aria-expanded={open} aria-controls="workspace-navigation" onClick={() => setOpen(true)} /><span>{mode === 'admin' ? text('管理', 'Manage') : text('工作台', 'Workspace')}</span><Icon name="chevronRight" size={13} /><strong>{title}</strong></div><div className="workspace__utilities"><Button variant="ghost" size="sm" icon="globe" onClick={() => setLanguage(en ? 'zh' : 'en')}>{en ? '中文' : 'EN'}</Button><Button variant="ghost" size="sm" icon="logout" onClick={async () => { await logout(); navigate('/', { replace: true }) }}>{text('退出', 'Sign out')}</Button></div></header>
      <main id="workspace-main" className="workspace__main" tabIndex={-1}>{children}</main>
    </div>
  </div>
}
