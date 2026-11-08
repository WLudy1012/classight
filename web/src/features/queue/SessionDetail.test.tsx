import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/store'
import { initI18n, setLanguage } from '@/shared/i18n'
import { speechApi, type SpeechEntry, type SpeechSessionDetail } from '@/shared/api'
import { SessionDetail } from './SessionDetail'

vi.mock('./CoursewarePanel', () => ({ CoursewarePanel: () => null }))

beforeEach(() => {
  initI18n(); setLanguage('zh')
  useAuth.setState({ status: 'authenticated', user: { id: 'admin', username: 'admin', displayName: 'Admin', bio: '', roles: ['Admin'], permissions: ['speech.manage'], createdAt: '2026-01-01', version: 1 } })
  vi.spyOn(speechApi, 'capabilities').mockResolvedValue({ pptConverter: false, maxCoursewareMb: 40, allowedKinds: ['pptx'], defaults: { slotMinutes: 5, allowTeams: true, maxTeamSize: 4 } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('reorders only queued entries while a meeting contains finished presentations', async () => {
  const entry = (id: string, position: number, status: SpeechEntry['status']): SpeechEntry => ({ id, sessionId: 'meeting', position, topic: id, status, owner: { id, displayName: id }, mine: false, version: 1 })
  const meeting: SpeechSessionDetail = { id: 'meeting', title: '班会', date: '2026-11-01', description: '', slotMinutes: 5, allowTeams: false, maxTeamSize: 4, submissionsOpen: true, status: 'running', entryCount: 3, version: 1, createdAt: '2026-11-01', teams: [], entries: [entry('finished', 1, 'done'), entry('first', 2, 'queued'), entry('second', 3, 'queued')] }
  vi.spyOn(speechApi, 'session').mockResolvedValue(meeting)
  const reorder = vi.spyOn(speechApi, 'setOrder').mockResolvedValue(meeting)
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={query}><MemoryRouter><SessionDetail sessionId="meeting" /></MemoryRouter></QueryClientProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '上移 second' }))
  await waitFor(() => expect(reorder).toHaveBeenCalledWith('meeting', ['second', 'first']))
  expect(screen.queryByRole('button', { name: '上移 finished' })).not.toBeInTheDocument()
})
