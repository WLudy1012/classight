import { ApiError } from './errors'
import type { ProblemDetails } from './types'

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string // relative to /api/v1, e.g. "/class/overview"
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  headers: Record<string, string>
  signal?: AbortSignal
  /** Upload progress (multipart bodies). Only the transports that can measure it call this. */
  onProgress?: (loaded: number, total: number) => void
  /** 'blob': a successful body comes back as a Blob (file downloads). Errors are still parsed as ProblemDetails. */
  responseType?: 'json' | 'blob'
}

export interface TransportResponse {
  status: number
  body: unknown
}

/** A transport turns a request into a response. `http` talks to the backend, `mock` is in-memory. */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>

let transport: Transport | null = null
let accessToken: string | null = null
let refresher: (() => Promise<string | null>) | null = null
let onSessionLost: (() => void) | null = null
let language = 'zh'

export const api = {
  setTransport(t: Transport) {
    transport = t
  },
  setAccessToken(t: string | null) {
    accessToken = t
  },
  getAccessToken: () => accessToken,
  setLanguage(l: string) {
    language = l
  },
  /** Auth store registers how a 401 gets recovered (silent refresh). */
  setRefresher(fn: () => Promise<string | null>, lost: () => void) {
    refresher = fn
    onSessionLost = lost
  },
}

export interface RequestOptions {
  query?: TransportRequest['query']
  body?: unknown
  signal?: AbortSignal
  /** Extra request headers (e.g. X-Setup-Token). */
  headers?: Record<string, string>
  onProgress?: TransportRequest['onProgress']
  responseType?: TransportRequest['responseType']
  /** Internal: skip the 401→refresh→retry loop (used by the refresh call itself). */
  noRefresh?: boolean
}

async function send(method: TransportRequest['method'], path: string, opts: RequestOptions): Promise<TransportResponse> {
  if (!transport) throw new Error('API transport not configured')
  const headers: Record<string, string> = { 'Accept-Language': language, ...opts.headers }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return transport({ method, path, query: opts.query, body: opts.body, headers, signal: opts.signal, onProgress: opts.onProgress, responseType: opts.responseType })
}

function toError(res: TransportResponse): ApiError {
  const p = (res.body ?? {}) as Partial<ProblemDetails>
  return new ApiError({
    status: res.status,
    code: p.code ?? (res.status >= 500 ? 'server.error' : 'resource.not_found'),
    detail: p.detail ?? p.title,
    title: p.title,
    errors: p.errors,
    traceId: p.traceId,
  })
}

let refreshing: Promise<string | null> | null = null

export async function request<T>(method: TransportRequest['method'], path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(method, path, opts)
  if (res.status === 401 && refresher && !opts.noRefresh) {
    refreshing ??= refresher().finally(() => {
      refreshing = null
    })
    const token = await refreshing
    if (token) {
      res = await send(method, path, opts)
    } else {
      onSessionLost?.()
    }
  }
  if (res.status >= 400) throw toError(res)
  return res.body as T
}

export const get = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
  request<T>('GET', path, { query, signal })
/** Authenticated file download (Bearer + silent refresh), returned as a Blob. */
export const getBlob = (path: string, signal?: AbortSignal) => request<Blob>('GET', path, { signal, responseType: 'blob' })
export const post = <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body })

/**
 * Multipart upload with progress. Goes through the same Bearer / 401-refresh path as every other
 * call (the form is re-sent after a silent refresh, progress restarts from 0).
 */
export function uploadWithProgress<T>(
  path: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  return request<T>('POST', path, { body: fd, signal, onProgress })
}
export const put = <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body })
export const patch = <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body })
export const del = <T = void>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts)

function parseBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text }
  }
}

/** XHR is the only browser API that reports upload progress. */
function xhrSend(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: FormData,
  signal: AbortSignal | undefined,
  onProgress: NonNullable<TransportRequest['onProgress']>,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.withCredentials = true
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.onload = () => resolve({ status: xhr.status, body: parseBody(xhr.responseText) })
    xhr.onerror = () => reject(new TypeError('Network error'))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(body)
  })
}

/** Real backend transport. Refresh cookie is HttpOnly, so credentials: include. */
export function httpTransport(base: string): Transport {
  return async ({ method, path, query, body, headers, signal, onProgress, responseType }) => {
    const qs = query
      ? '?' +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    const url = base + path + (qs === '?' ? '' : qs)
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData
    if (isForm && onProgress) return xhrSend(url, method, headers, body as FormData, signal, onProgress)
    const res = await fetch(url, {
      method,
      headers: { ...headers, ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      credentials: 'include',
      signal,
    })
    if (responseType === 'blob' && res.ok) return { status: res.status, body: await res.blob() }
    return { status: res.status, body: parseBody(await res.text()) }
  }
}
