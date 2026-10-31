import { generatePath, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { NotFoundPage } from '@/app/NotFound'
import { RequireAuth } from '@/features/auth/guards'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { Icon } from '@/shared/ui'
import { usePluginStates } from '@/shared/plugins'
import { CENTER_PATH } from './paths'
import { getClassCenterPlugins } from './registry'
import './plugins'
import './class-center.css'

export { getClassCenterPlugins } from './registry'

export function LegacyPluginRoute({ path }: { path: string }) {
  const params = useParams()
  const location = useLocation()
  return <Navigate to={`${generatePath(`${CENTER_PATH}/${path}`, params)}${location.search}${location.hash}`} replace />
}

function CenterIndex() {
  const { t } = useTranslation()
  const user = useAuth((state) => state.user)
  const states = usePluginStates()
  const plugins = getClassCenterPlugins().filter((plugin) => states.data?.[plugin.id] && can(user, plugin.permission))
  useDocumentTitle(t('center.title'))
  return (
    <PageShell back>
      <main className="center page">
        <Link to="/console" className="btn btn-ghost btn-sm center__back"><Icon name="arrowLeft" /> {t('console.title')}</Link>
        <h1 className="page__title">{t('center.title')}</h1>
        <p className="page__sub">{t('center.description')}</p>
        {plugins.length ? (
          <nav aria-label={t('center.title')}>
            <ul className="center__list">
              {plugins.map((plugin) => (
                <li key={plugin.id}>
                  <Link to={`${CENTER_PATH}/${plugin.path}`}>
                    <Icon name={plugin.icon} />
                    <span><strong>{t(plugin.label)}</strong><small>{t(plugin.description)}</small></span>
                    <Icon name="arrowRight" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : <p className="center__empty">{t('center.empty')}</p>}
      </main>
    </PageShell>
  )
}

export default function ClassCenter() {
  const states = usePluginStates()
  if (states.isPending) return null
  if (states.isError) return <NotFoundPage />
  return (
    <Routes>
      <Route index element={<CenterIndex />} />
      {getClassCenterPlugins().filter((plugin) => states.data[plugin.id]).flatMap((plugin) => plugin.routes.map((route) => (
        <Route key={`${plugin.id}:${route.path}`} path={route.path} element={<RequireAuth permission={plugin.permission}><route.element /></RequireAuth>} />
      )))}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
