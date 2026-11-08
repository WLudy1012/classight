import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserSelf } from '@/shared/api'
import { useAuth } from '@/features/auth/store'
import AdminLayout from './AdminLayout'

vi.mock('./modules', () => ({}))
vi.mock('./registry', () => ({
  getAdminModules: () => [{ id: 'users', group: 'people', order: 1, label: 'users', path: 'users', icon: 'user', permission: 'users.read', element: () => <div>Account management</div> }],
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/shared/hooks', () => ({ useDocumentTitle: () => {} }))

function CurrentLocation() {
  return <output>{useLocation().pathname}</output>
}

function show(path: string, permissions: UserSelf['permissions']) {
  useAuth.setState({ status: 'authenticated', user: { id: 'user', permissions } as UserSelf })
  return render(<MemoryRouter initialEntries={[path]}><CurrentLocation /><Routes><Route path="/admin/*" element={<AdminLayout />} /></Routes></MemoryRouter>)
}

afterEach(cleanup)

describe('administration routes', () => {
  it('renders permitted modules without adding another navigation shell', () => {
    show('/admin/users', ['users.read'])
    expect(screen.getByText('Account management')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('keeps a restricted destination and shows permission feedback', () => {
    show('/admin/users', [])
    expect(screen.getByText('auth.forbidden')).toBeInTheDocument()
    expect(screen.getByText('/admin/users')).toBeInTheDocument()
    expect(screen.queryByText('Account management')).not.toBeInTheDocument()
  })

  it('shows missing pages instead of silently redirecting to the overview', () => {
    show('/admin/missing', ['users.read'])
    expect(screen.getByText('notFound.title')).toBeInTheDocument()
    expect(screen.getByText('/admin/missing')).toBeInTheDocument()
  })
})
