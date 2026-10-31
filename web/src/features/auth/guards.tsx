import { Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Permission } from '@/shared/api'
import { LinkButton, Spinner, StateView } from '@/shared/ui'
import { can, useAuth } from './store'

export function RequireAuth({ children, permission }: { children: ReactNode; permission?: Permission }) {
  const { status, user } = useAuth()
  const { t } = useTranslation()
  const loc = useLocation()

  if (status === 'booting')
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 12 }}>
        <Spinner label={t('auth.restoring')} />
      </div>
    )
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search + loc.hash }} />
  if (permission && !can(user, permission))
    return (
      <StateView
        icon="shield"
        title={t('auth.forbidden')}
        body={t('auth.forbiddenBody')}
        action={
          <LinkButton to="/" variant="secondary">
            {t('notFound.home')}
          </LinkButton>
        }
      />
    )
  return <>{children}</>
}

