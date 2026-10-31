import { useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { setLanguage } from '@/shared/i18n'
import { Button, Icon, StateView, LinkButton } from '@/shared/ui'
import { getAdminModules } from './registry'
import './modules'
import './admin.css'

const GROUPS = ['overview', 'class', 'people', 'site'] as const

export default function AdminLayout() {
  const { t, i18n } = useTranslation()
  const user = useAuth((s) => s.user)
  const [open, setOpen] = useState(false)
  useDocumentTitle(`${t('admin.title')}`)

  // The shell only knows the registry: it filters by the signed-in user's permissions.
  const modules = useMemo(() => getAdminModules().filter((m) => can(user, m.permission)), [user])
  const other = i18n.language === 'en' ? 'zh' : 'en'

  return (
    <div className="admin">
      <aside className="admin__side" data-open={open}>
        <div className="admin__top">
          <Link to="/admin" className="admin__brand">
            <span className="shell__mark" aria-hidden="true" />
            {t('admin.title')}
          </Link>
          <Button
            className="admin__menu-toggle"
            variant="ghost"
            iconOnly
            size="sm"
            icon={open ? 'close' : 'menu'}
            aria-expanded={open}
            aria-label="menu"
            onClick={() => setOpen((o) => !o)}
          />
        </div>
        <nav className="admin__nav" aria-label={t('admin.title')} onClick={() => setOpen(false)}>
          {GROUPS.map((g) => {
            const items = modules.filter((m) => m.group === g)
            if (!items.length) return null
            return (
              <div key={g} style={{ display: 'contents' }}>
                {g !== 'overview' && <div className="admin__group">{t(`admin.nav.group_${g}`)}</div>}
                {items.map((m) => (
                  <NavLink key={m.id} to={m.path ? `/admin/${m.path}` : '/admin'} end={m.path === ''}>
                    <Icon name={m.icon} /> {t(m.label)}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="admin__foot">
          <Link to="/" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }}>
            <Icon name="arrowLeft" /> {t('admin.backToSite')}
          </Link>
          <Button variant="ghost" size="sm" icon="globe" style={{ justifyContent: 'flex-start' }} onClick={() => setLanguage(other)}>
            {other === 'en' ? 'English' : '中文'}
          </Button>
        </div>
      </aside>

      <main className="admin__main">
        <Routes>
          {modules.map((m) => (
            <Route key={m.id} path={m.path || undefined} index={m.path === ''} element={<m.element />} />
          ))}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        {modules.length === 0 && (
          <StateView
            icon="shield"
            title={t('auth.forbidden')}
            action={
              <LinkButton to="/" variant="secondary">
                {t('notFound.home')}
              </LinkButton>
            }
          />
        )}
      </main>
    </div>
  )
}
