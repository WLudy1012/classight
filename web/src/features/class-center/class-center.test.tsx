import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LegacyPluginRoute } from './ClassCenter'
import { RequireAuth } from '@/features/auth/guards'
import { useAuth } from '@/features/auth/store'
import { getClassCenterPlugins, registerClassCenterPlugin, type ClassCenterPlugin } from './registry'

function Location() {
  const location = useLocation()
  return <div>{location.pathname}{location.search}{location.hash}</div>
}

function LoginLocation() {
  const location = useLocation()
  return <div>{(location.state as { from: string }).from}</div>
}

describe('class center plugins', () => {
  it('preserves the full destination when sign-in is required', async () => {
    useAuth.setState({ status: 'anonymous', user: null })
    render(
      <MemoryRouter initialEntries={['/center/meetings/abc?view=slides#preview']}>
        <Routes>
          <Route path="/center/*" element={<RequireAuth><div>Protected</div></RequireAuth>} />
          <Route path="/login" element={<LoginLocation />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('/center/meetings/abc?view=slides#preview')).toBeInTheDocument()
  })

  it('keeps legacy meeting links, parameters and query strings', async () => {
    render(
      <MemoryRouter initialEntries={['/queue/abc?view=slides#preview']}>
        <Routes>
          <Route path="/queue/:sessionId" element={<LegacyPluginRoute path="meetings/:sessionId" />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('/center/meetings/abc?view=slides#preview')).toBeInTheDocument()
  })

  it('exposes the meeting routes without restricting read access', () => {
    const meeting = getClassCenterPlugins().find((plugin) => plugin.id === 'meetings')
    expect(meeting?.permission).toBeUndefined()
    expect(meeting?.routes.map((route) => route.legacyPath)).toEqual(['/queue', '/queue/:sessionId'])
  })

  it('rejects duplicate routes instead of silently shadowing plugins', () => {
    const plugin: ClassCenterPlugin = {
      id: 'collision', order: 100, label: 'test', description: 'test', icon: 'grid', path: 'collision',
      routes: [{ path: 'meetings', element: () => null }],
    }
    expect(() => registerClassCenterPlugin(plugin)).toThrow('Duplicate class center route')
  })
})
