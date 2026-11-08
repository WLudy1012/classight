import { Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { NotFoundPage } from '@/app/NotFound'
import { RequireAuth } from '@/features/auth/guards'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { LinkButton, StateView } from '@/shared/ui'
import { getAdminModules } from './registry'
import './modules'
import './admin.css'

export default function AdminLayout() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  useDocumentTitle(t('admin.title'))
  const modules = getAdminModules()
  if (!modules.some((module) => module.group !== 'overview' && can(user, module.permission)))
    return <StateView icon="shield" title={t('auth.forbidden')} body={t('auth.forbiddenBody')} action={<LinkButton to="/center">{t('center.title')}</LinkButton>} />
  return (
    <Routes>
      {modules.map((module) => (
        <Route
          key={module.id}
          path={module.path || undefined}
          index={module.path === ''}
          element={<RequireAuth permission={module.permission}><module.element /></RequireAuth>}
        />
      ))}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
