import { lazy, Suspense, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RequireAuth } from '@/features/auth/guards'
import { useAuth } from '@/features/auth/store'
import { setupApi } from '@/shared/api'
import { Spinner, ToastHost, toast } from '@/shared/ui'
import { NotFoundPage } from './NotFound'
import ClassCenter, { getClassCenterPlugins, LegacyPluginRoute } from '@/features/class-center/ClassCenter'

const HomePage = lazy(() => import('@/features/home/HomePage'))
const LoginPage = lazy(() => import('@/features/auth/AuthPages').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/features/auth/AuthPages').then((m) => ({ default: m.RegisterPage })))
const ClassPage = lazy(() => import('@/features/class-info/ClassPage'))
const WorkspaceShell = lazy(() => import('./WorkspaceShell'))
const AdminLayout = lazy(() => import('@/features/admin/AdminLayout'))
const SetupPage = lazy(() => import('@/features/setup/SetupPage'))

function Loading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--fg-500)' }}>
      <Spinner />
    </div>
  )
}

/** Tells the user (once) when a 401 could not be recovered, then sends them to sign in. */
function SessionWatcher() {
  const lost = useAuth((s) => s.sessionLost)
  const nav = useNavigate()
  const { t } = useTranslation()
  useEffect(() => {
    if (!lost) return
    toast.error(t('auth.sessionLost'))
    useAuth.getState().clearSessionLost()
    nav('/login', { replace: true })
  }, [lost, nav, t])
  return null
}

export const setupKey = ['setup', 'status'] as const

function LegacyConsoleRoute() {
  const location = useLocation()
  const path = location.pathname === '/console/profile' ? '/center/account'
    : location.pathname === '/console/security' ? '/center/account/security' : '/center'
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />
}

/**
 * First-run gate. While the server says setup is unfinished everything routes to /setup; once the administrator exists
 * but the wizard was not completed, the administrator is sent back to finish it. If the status call itself fails
 * (backend down) the app carries on and shows its normal error states.
 */
function SetupGate() {
  const loc = useLocation()
  const nav = useNavigate()
  const authStatus = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const q = useQuery({ queryKey: setupKey, queryFn: setupApi.status, retry: false, staleTime: 30_000, refetchOnWindowFocus: false })
  const s = q.data
  useEffect(() => {
    if (!s || loc.pathname.startsWith('/setup')) return
    const unfinished = s.state !== 'ready'
    const resume = s.state === 'ready' && !s.setupCompleted && authStatus === 'authenticated' && !!user?.permissions.includes('system.manage')
    if (unfinished || resume) nav('/setup', { replace: true })
  }, [s, loc.pathname, authStatus, user, nav])
  return null
}

export function App() {
  return (
    <>
      <SessionWatcher />
      <SetupGate />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/class" element={<ClassPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/center/*" element={<RequireAuth><WorkspaceShell><ClassCenter /></WorkspaceShell></RequireAuth>} />
          {getClassCenterPlugins().flatMap((plugin) => plugin.routes.filter((route) => route.legacyPath).map((route) => (
            <Route key={route.legacyPath} path={route.legacyPath} element={<LegacyPluginRoute path={route.path} />} />
          )))}
          <Route
            path="/console/*"
            element={
              <RequireAuth>
                <LegacyConsoleRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/*"
            element={
              <RequireAuth>
                <WorkspaceShell mode="admin"><AdminLayout /></WorkspaceShell>
              </RequireAuth>
            }
          />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </>
  )
}
