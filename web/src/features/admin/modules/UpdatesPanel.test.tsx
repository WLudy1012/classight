import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adminApi, type UpdateStatus } from '@/shared/api'
import { useAuth } from '@/features/auth/store'
import { initI18n, setLanguage } from '@/shared/i18n'
import { UpdatesPanel } from './UpdatesPanel'

const status: UpdateStatus = { currentVersion: '1.0.1', supported: true, enabled: true, platform: 'windows', phase: 'current',
  latestVersion: null, lastCheckedAt: null, nextCheckAt: null, downloadedBytes: 0, totalBytes: 0, errorCode: null,
  restartRequired: false, backupAvailable: false }
let query: QueryClient
beforeEach(() => {
  initI18n(); setLanguage('zh')
  useAuth.setState({ user: { id: 'admin', username: 'admin', displayName: 'Admin', roles: ['Admin'], permissions: ['system.read', 'system.manage'], bio: '', createdAt: '', version: 1 } })
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { cleanup(); query.clear(); vi.restoreAllMocks() })
function show(value: UpdateStatus) {
  vi.spyOn(adminApi, 'updateStatus').mockResolvedValue(value)
  render(<QueryClientProvider client={query}><UpdatesPanel /></QueryClientProvider>)
}

it('queues a manual check and prevents duplicate clicks while downloading', async () => {
  const check = vi.spyOn(adminApi, 'checkUpdate').mockResolvedValue({ ...status, phase: 'downloading', totalBytes: 100, downloadedBytes: 50 })
  show(status)
  const button = await screen.findByRole('button', { name: '检查更新' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await screen.findByText('正在下载')
  expect(button).toBeDisabled()
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50')
  expect(check).toHaveBeenCalledTimes(1)
})

it('explains how a pending Windows update takes effect', async () => {
  show({ ...status, phase: 'ready', restartRequired: true, latestVersion: '1.1.0' })
  expect(await screen.findByText('等待重启生效')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('退出程序后会自动替换')
  expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled()
})

it('shows the retry reason and hides the check action from read-only users', async () => {
  useAuth.setState({ user: { ...useAuth.getState().user!, roles: [], permissions: ['system.read'] } })
  show({ ...status, phase: 'error', errorCode: 'network', nextCheckAt: '2026-11-15T12:00:00Z' })
  expect(await screen.findByRole('alert')).toHaveTextContent('无法连接 GitHub')
  expect(screen.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument()
})
