import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/store'
import { initI18n, setLanguage } from '@/shared/i18n'
import { authApi } from '@/shared/api'
import type { PluginManifest } from '@/shared/plugins'
import WorkspaceShell from './WorkspaceShell'

const states = vi.hoisted(() => ({ data: { meetings: true, timetable: false, 'member-identity': true }, isPending: false, isError: false }))
const catalog = vi.hoisted(() => ({ data: undefined as PluginManifest[] | undefined, isPending: false, isError: false, refetch: vi.fn() }))
vi.mock('@/shared/plugins', () => ({ usePluginStates: () => states, usePluginCatalog: () => catalog }))
vi.mock('@/shared/site', () => ({ useSite: () => ({ data: {} }), useClassName: () => 'Classight' }))
vi.mock('@/shared/hooks', () => ({ useMediaQuery: () => false }))

beforeEach(() => {
  initI18n()
  setLanguage('zh')
  useAuth.setState({ status: 'authenticated', user: { id: 'student', username: 'student', displayName: '同学', bio: '', roles: ['Member'], permissions: ['speech.participate'], createdAt: '2026-01-01', version: 1 } })
})
afterEach(() => { cleanup(); catalog.data = undefined; vi.restoreAllMocks(); vi.useRealTimers() })

it('shows enabled class tools while keeping account extensions in account settings', () => {
  render(<MemoryRouter><WorkspaceShell>content</WorkspaceShell></MemoryRouter>)
  expect(screen.getByRole('link', { name: '班会排队' })).toHaveAttribute('href', '/center/meetings')
  expect(screen.queryByRole('link', { name: '课程表' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '成员权限' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '管理' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /同学.*账户设置/ })).toHaveAttribute('href', '/center/account')
})

it('allows a partial administrator to reach the modules they can use', () => {
  useAuth.setState({ user: { ...useAuth.getState().user!, permissions: ['users.read'] } })
  render(<MemoryRouter initialEntries={['/admin/users']}><WorkspaceShell mode="admin">content</WorkspaceShell></MemoryRouter>)
  expect(screen.getByRole('link', { name: '管理' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '用户' })).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByRole('link', { name: '站点设置' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/center')
})

it('refreshes permissions again after background DLL permission registration', async () => {
  vi.useFakeTimers()
  catalog.data = []
  const user = useAuth.getState().user!
  const me = vi.spyOn(authApi, 'me').mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, permissions: ['speech.participate', 'site.settings.read'] })
  render(<MemoryRouter><WorkspaceShell>content</WorkspaceShell></MemoryRouter>)
  await act(async () => {})
  expect(me).toHaveBeenCalledTimes(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
  expect(me).toHaveBeenCalledTimes(2)
  expect(useAuth.getState().user?.permissions).toContain('site.settings.read')
})
