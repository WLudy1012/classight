import type { Transport } from '../client'
import { dispatch } from './handlers'

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

/** In-memory transport with a little latency so loading states are real. */
export function mockTransport(latencyMs = 140): Transport {
  return async ({ method, path, query, body, headers, signal, onProgress }) => {
    if (latencyMs > 0) await wait(latencyMs * (0.6 + Math.random() * 0.8), signal)

    // uploads: simulate the wire so progress bars have something to show (a few ticks, ~1s)
    if (onProgress && typeof FormData !== 'undefined' && body instanceof FormData) {
      const f = body.get('file')
      const total = f instanceof Blob ? Math.max(f.size, 1) : 1
      const ticks = latencyMs > 0 ? 8 : 1
      for (let i = 1; i <= ticks; i++) {
        if (latencyMs > 0) await wait(110, signal)
        onProgress(Math.round((total * i) / ticks), total)
      }
    }
    return dispatch(method, path, query ?? {}, body, headers)
  }
}
