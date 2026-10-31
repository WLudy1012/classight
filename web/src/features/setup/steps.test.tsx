import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseStep, SiteStep } from './steps'
import type { SetupStatus } from '@/shared/api'

const services = vi.hoisted(() => ({ testDatabase: vi.fn(), applyDatabase: vi.fn(), settingsGroup: vi.fn(), saveSettings: vi.fn() }))
vi.mock('@/shared/api', () => ({ setupApi: { testDatabase: services.testDatabase, applyDatabase: services.applyDatabase }, adminApi: { settingsGroup: services.settingsGroup, saveSettings: services.saveSettings }, api: {} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/features/auth/store', () => ({ useAuth: () => '' }))
vi.mock('@/shared/i18n', () => ({ errorMessage: (error: Error) => error.message, fieldErrors: () => ({}) }))

const status: SetupStatus = { state: 'needs_database', setupCompleted: false, tokenRequired: true, database: { provider: 'Sqlite', configured: false, connected: false }, storage: { path: '', writable: true }, converter: { available: false }, jwtKeyIsDefault: true, environment: 'Development', version: 'test' }
const props = { status, token: 'token', refresh: vi.fn(), next: vi.fn(), back: vi.fn(), signedIn: true }
function renderStep(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('setup recovery', () => {
  it('requires a fresh database test after changing input mode', async () => {
    services.testDatabase.mockResolvedValue({ ok: true, message: 'connected' })
    renderStep(<DatabaseStep {...props} setToken={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'setup.db.test' }))
    await screen.findByText('connected')
    expect(screen.getByRole('button', { name: 'setup.db.apply' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'setup.db.raw' }))
    fireEvent.change(screen.getByLabelText('setup.db.connectionString'), { target: { value: 'Data Source=other.db' } })
    expect(screen.getByRole('button', { name: 'setup.db.apply' })).toBeDisabled()
    expect(screen.queryByText('connected')).not.toBeInTheDocument()
  })

  it('retries a partial site save with the updated version and preserves edits', async () => {
    services.settingsGroup.mockImplementation(async (group: string) => group === 'site'
      ? { values: { className: 'Class', classNameEn: '', slogan: '' }, version: 1 }
      : { values: { particleColor: '#0b1220' }, version: 1 })
    services.saveSettings.mockImplementation(async (group: string, values: object, version: number) => {
      if (group === 'appearance' && services.saveSettings.mock.calls.filter((call) => call[0] === 'appearance').length === 1) throw new Error('failed')
      return { values, version: version + 1 }
    })
    renderStep(<SiteStep {...props} />)
    const field = await screen.findByLabelText('setup.site.className')
    await waitFor(() => expect(field).toHaveValue('Class'))
    fireEvent.change(field, { target: { value: 'New class' } })
    fireEvent.click(screen.getByRole('button', { name: 'setup.saveNext' }))
    await waitFor(() => expect(services.saveSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'setup.saveNext' })).toBeEnabled())
    expect(field).toHaveValue('New class')
    fireEvent.click(screen.getByRole('button', { name: 'setup.saveNext' }))
    await waitFor(() => expect(services.saveSettings).toHaveBeenCalledTimes(4))
    expect(services.saveSettings.mock.calls[2]?.[2]).toBe(2)
  })
})
