import { api, httpTransport, type Transport } from './client'

export * from './client'
export * from './endpoints'
export * from './errors'
export * from './types'

/**
 * Pick the transport once at startup. `VITE_API_MODE=http` talks to the real backend; the mock
 * (and its zip/pptx helpers) is only fetched when it is actually used.
 */
export function configureApi() {
  const mode = import.meta.env.VITE_API_MODE ?? 'mock'
  if (mode === 'http') {
    api.setTransport(httpTransport(import.meta.env.VITE_API_BASE ?? '/api/v1'))
    return
  }
  let mock: Promise<Transport> | null = null
  api.setTransport(async (req) => {
    mock ??= import('./mock/transport').then((m) => m.mockTransport())
    return (await mock)(req)
  })
}

export const isMockApi = () => (import.meta.env.VITE_API_MODE ?? 'mock') !== 'http'

/** Mock only: put the setup wizard back to its first step so `/setup?demo=1` can replay it. */
export async function replaySetupDemo() {
  if (!isMockApi()) return
  const m = await import('./mock/setup')
  m.replaySetup()
}
