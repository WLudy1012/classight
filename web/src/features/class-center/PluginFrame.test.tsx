import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import * as client from '@/shared/api/client'
import { initI18n } from '@/shared/i18n'
import { PluginFrame } from './PluginFrame'
import { discoverClassCenterPlugins } from './runtime'

beforeEach(() => { initI18n() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); client.api.setAccessToken(null) })

it('remounts a plugin interface after a successful DLL generation change', () => {
  const view = render(<PluginFrame id="custom" entry="/api/v1/plugins/custom/ui/index.html" generation="one" title="Custom plugin" />)
  const original = screen.getByTitle('Custom plugin')
  view.rerender(<PluginFrame id="custom" entry="/api/v1/plugins/custom/ui/index.html" generation="two" title="Custom plugin" />)
  expect(screen.getByTitle('Custom plugin')).not.toBe(original)
  expect(screen.getByTitle('Custom plugin')).toHaveAttribute('src', expect.stringContaining('generation=two'))
})

it('keeps an active interface mounted when another DLL changes', () => {
  const manifest = { id: 'custom', name: 'Custom plugin', description: '', version: '1', generation: 'one', workspacePath: 'custom', uiEntry: '/api/v1/plugins/custom/ui/index.html' }
  const route = () => discoverClassCenterPlugins([manifest])[0]!.routes[0]!.element as ReactElement
  const view = render(route())
  const original = screen.getByTitle('Custom plugin')
  view.rerender(discoverClassCenterPlugins([manifest, { ...manifest, id: 'another', workspacePath: 'another', uiEntry: '/api/v1/plugins/another/ui/index.html' }])[0]!.routes[0]!.element as ReactElement)
  expect(screen.getByTitle('Custom plugin')).toBe(original)
})

it('authenticates only requests from the current plugin frame and never gives it the access token', async () => {
  const request = vi.spyOn(client, 'request').mockResolvedValue({ saved: true })
  client.api.setAccessToken('host-access-token')
  render(<PluginFrame id="custom" entry="/api/v1/plugins/custom/ui/index.html" generation="one" title="Custom plugin" />)
  const frame = screen.getByTitle('Custom plugin') as HTMLIFrameElement
  expect(frame).not.toHaveAttribute('sandbox', expect.stringContaining('allow-same-origin'))
  const reply = vi.spyOn(frame.contentWindow!, 'postMessage')
  fireEvent.load(frame)
  expect(JSON.stringify(reply.mock.calls)).not.toContain('host-access-token')
  fireEvent(window, new MessageEvent('message', { source: window, data: { type: 'classight:request', requestId: 'other', path: '/plugins/custom/api/data' } }))
  expect(request).not.toHaveBeenCalled()
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow!, data: { type: 'classight:request', requestId: 'denied', path: '/admin/users' } }))
  expect(request).not.toHaveBeenCalled()
  expect(reply).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'denied', ok: false }), '*')
  fireEvent(window, new MessageEvent('message', { source: frame.contentWindow!, data: { type: 'classight:request', requestId: 'allowed', method: 'POST', path: '/plugins/custom/api/data', body: { value: 1 } } }))
  await waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'allowed', ok: true, data: { saved: true } }), '*'))
  expect(request).toHaveBeenCalledWith('POST', '/plugins/custom/api/data', expect.objectContaining({ body: { value: 1 } }))
})
