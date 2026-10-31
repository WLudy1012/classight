import { NavLink, Route, Routes, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { Avatar, Button, Icon } from '@/shared/ui'
import { ConsoleHome } from './ConsoleHome'
import { ProfilePage } from './ProfilePage'
import { SecurityPage } from './SecurityPage'
import './console.css'

export default function ConsoleLayout() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  useDocumentTitle(t('console.title'))
  if (!user) return null
  return (
    <PageShell back>
      <div className="console">
        <aside className="console__side">
          <div className="console__who">
            <Avatar name={user.displayName} src={user.avatarUrl} size={44} />
            <div>
              <strong>{user.displayName}</strong>
              <span>@{user.username}</span>
            </div>
          </div>
          <nav className="console__nav" aria-label={t('console.title')}>
            <NavLink to="/console" end>
              <Icon name="grid" /> {t('console.title')}
            </NavLink>
            <NavLink to="/console/profile">
              <Icon name="user" /> {t('console.profile')}
            </NavLink>
            <NavLink to="/console/security">
              <Icon name="shield" /> {t('console.security')}
            </NavLink>
            <Link to="/center">
              <Icon name="grid" /> {t('center.title')}
            </Link>
            <Link to="/class">
              <Icon name="users" /> {t('console.classInfo')}
            </Link>
          </nav>
          <div className="console__side-foot">
            <Link to="/" className="btn btn-ghost btn-sm">
              <Icon name="arrowLeft" /> {t('console.backHome')}
            </Link>
            <Button variant="ghost" size="sm" icon="logout" onClick={() => void logout()}>
              {t('auth.logout')}
            </Button>
          </div>
        </aside>
        <main className="console__main">
          <Routes>
            <Route index element={<ConsoleHome />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="*" element={<Navigate to="/console" replace />} />
          </Routes>
        </main>
      </div>
    </PageShell>
  )
}
