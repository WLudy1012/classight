import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClassCenter from './ClassCenter'
import { useAuth } from '@/features/auth/store'
import { initI18n, setLanguage } from '@/shared/i18n'

const states = vi.hoisted(() => ({
  data: { meetings: true, timetable: true, 'member-identity': true } as Record<string, boolean>,
  isPending: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}))
vi.mock('@/shared/plugins', () => ({ usePluginStates: () => states, usePluginCatalog: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }) }))
vi.mock('@/features/member-identity/permissions', () => ({ useMemberPermissions: () => ({ data: { permissions: ['speech.participate'] }, isPending: false, isError: false }) }))

function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path="/center/*" element={<ClassCenter />} /></Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  initI18n()
  setLanguage('zh')
  useAuth.setState({ status: 'authenticated', user: { id: 'student', username: 'student', displayName: '同学', bio: '', roles: ['Member'], permissions: ['speech.participate'], createdAt: '2026-01-01', version: 1 } })
  states.data = { meetings: true, timetable: true, 'member-identity': true }
  states.isPending = false
  states.isError = false
  states.error = null
  states.refetch.mockClear()
})
afterEach(cleanup)

describe('unified workspace', () => {
  it('keeps account extensions out of class tools and supports searching available tools', () => {
    open('/center')
    expect(screen.getByRole('link', { name: /课程表/ })).toHaveAttribute('href', '/center/timetable')
    expect(screen.queryByRole('link', { name: /成员权限/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索工具' }), { target: { value: '课程' } })
    expect(screen.getByRole('link', { name: /课程表/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /班会排队/ })).not.toBeInTheDocument()
  })

  it('exposes enabled account plugins beside profile and security without duplicate page headings', () => {
    open('/center/account')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /资料/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /成员权限/ })).toHaveAttribute('href', '/center/identity')
  })

  it('keeps the existing permissions deep link inside account settings', async () => {
    open('/center/identity')
    expect(await screen.findByText('speech.participate')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /成员权限/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /安全/ })).toHaveAttribute('href', '/center/account/security')
  })

  it('offers retry when plugin state loading fails', () => {
    states.isError = true
    states.error = new Error('offline')
    open('/center')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(states.refetch).toHaveBeenCalledOnce()
  })
})
