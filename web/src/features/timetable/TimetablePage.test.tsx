import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/store'
import { get, put } from '@/shared/api/client'
import { i18n, initI18n } from '@/shared/i18n'
import TimetablePage from './TimetablePage'
import { emptyTimetable, type Timetable } from './model'

vi.mock('@/shared/api/client', async (original) => ({ ...await original<typeof import('@/shared/api/client')>(), get: vi.fn(), put: vi.fn() }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TimetablePage /></QueryClientProvider>)
}

beforeAll(() => { initI18n() })

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  vi.mocked(get).mockReset().mockResolvedValue(emptyTimetable())
  vi.mocked(put).mockReset().mockImplementation(async (_path, data) => ({ ...(data as Timetable), version: 1 }))
  useAuth.setState({ user: { id: 'teacher', username: 'teacher', displayName: 'Teacher', bio: '', roles: ['Admin'], permissions: ['timetable.manage'], createdAt: '', version: 1 } })
})

describe('timetable workspace modes', () => {
  it('separates viewing from editing and preserves changes across editor sections', async () => {
    renderPage()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑安排' }))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '学期与作息' }))
    fireEvent.change(screen.getByLabelText('学期名称'), { target: { value: '秋季学期' } })
    fireEvent.click(screen.getByRole('tab', { name: /课程安排/ }))
    fireEvent.click(screen.getByRole('button', { name: '添加课程' }))
    expect(screen.getByRole('button', { name: '保存课程表' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('课程名称'), { target: { value: '数学' } })
    fireEvent.click(screen.getByRole('button', { name: '确认课程' }))
    expect(screen.getByRole('button', { name: '保存课程表' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存课程表' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/timetable', expect.objectContaining({ term: '秋季学期', lessons: [expect.objectContaining({ name: '数学' })] })))
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('keeps timetable editing unavailable to a read-only member', async () => {
    useAuth.setState({ user: { ...useAuth.getState().user!, permissions: [] } })
    renderPage()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑安排' })).not.toBeInTheDocument()
  })
})
