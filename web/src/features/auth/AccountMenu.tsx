import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar, Icon, LinkButton } from '@/shared/ui'
import { can, useAuth } from './store'
import './account-menu.css'

/** Top-right of the home stage: "Sign in" when anonymous, avatar + menu when signed in. */
export function AccountMenu() {
  const { t } = useTranslation()
  const { status, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (status === 'booting') return <div style={{ width: 88, height: 40 }} aria-hidden="true" />

  if (status === 'anonymous' || !user)
    return (
      <LinkButton to="/login" variant="secondary" data-magnet data-magnet-pad="5" icon="user">
        {t('home.login')}
      </LinkButton>
    )

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct__btn"
        data-magnet
        data-magnet-pad="5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('home.userMenu')}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={user.displayName} src={user.avatarUrl} size={36} />
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="acct__menu glass" role="menu">
          <div className="acct__who">
            <strong>{user.displayName}</strong>
            <span>@{user.username}</span>
          </div>
          <Link role="menuitem" to="/console" onClick={() => setOpen(false)}>
            <Icon name="user" /> {t('console.title')}
          </Link>
          <Link role="menuitem" to="/class" onClick={() => setOpen(false)}>
            <Icon name="users" /> {t('console.classInfo')}
          </Link>
          {can(user, 'site.settings.read') && (
            <Link role="menuitem" to="/admin" onClick={() => setOpen(false)}>
              <Icon name="sliders" /> {t('console.admin')}
            </Link>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false)
              await logout()
              nav('/', { replace: true })
            }}
          >
            <Icon name="logout" /> {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
