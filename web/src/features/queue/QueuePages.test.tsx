import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/store'
import { initI18n, setLanguage } from '@/shared/i18n'
import { speechApi } from '@/shared/api'
import { QueueListPage } from './QueuePages'

function Location() { return <output>{useLocation().pathname}</output> }
function show() {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={query}><MemoryRouter initialEntries={['/center/meetings']}><QueueListPage /><Location /></MemoryRouter></QueryClientProvider>)
}
beforeEach(() => {
  initI18n(); setLanguage('zh')
  vi.spyOn(speechApi, 'sessions').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 })
  vi.spyOn(speechApi, 'adminSessions').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 })
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
  useAuth.setState({ status: 'authenticated', user: { id: 'admin', username: 'admin', displayName: 'Admin', bio: '', roles: ['Admin'], permissions: ['speech.manage'], createdAt: '2026-01-01', version: 1 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('lets an administrator create a meeting and reaches its management page', async () => {
  const create = vi.spyOn(speechApi, 'createSession').mockResolvedValue({ id: 'new-meeting', title: '班会', date: '2026-11-01', description: '', slotMinutes: 5, allowTeams: true, maxTeamSize: 4, submissionsOpen: true, status: 'draft', entryCount: 0, version: 1, createdAt: '2026-11-01' })
  show()
  fireEvent.click(screen.getByRole('button', { name: '新建班会' }))
  fireEvent.change(screen.getByRole('textbox', { name: '班会名称' }), { target: { value: '班会' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(await screen.findByText('/center/meetings/new-meeting')).toBeInTheDocument()
  expect(speechApi.adminSessions).toHaveBeenCalled()
})
it('keeps ordinary members on the public meeting list without creation controls', async () => {
  useAuth.setState({ user: { ...useAuth.getState().user!, permissions: ['speech.participate'] } })
  show()
  await waitFor(() => expect(speechApi.sessions).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: '新建班会' })).not.toBeInTheDocument()
  expect(speechApi.adminSessions).not.toHaveBeenCalled()
})
