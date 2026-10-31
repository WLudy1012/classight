import { unzipSync } from 'fflate'
import { findWebIndex } from '../../courseware'

const MIME: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

const ext = (p: string) => p.toLowerCase().split('?')[0]!.split('#')[0]!.split('.').pop() ?? ''
const text = (b: Uint8Array) => new TextDecoder().decode(b)

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(bin)}`
}

/** Resolve `ref` against the directory of `from`, inside the zip. Returns null for external / unsafe refs. */
function resolve(from: string, ref: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null
  const clean = decodeURIComponent(ref.split('#')[0]!.split('?')[0]!)
  const parts = from.split('/').slice(0, -1)
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * Best-effort single-file build of an uploaded web project for the mock: stylesheets, scripts and
 * images are inlined (as text or data URLs). The real backend serves the folder as-is instead.
 */
export function buildWebHtml(zip: Uint8Array): string | null {
  const files = unzipSync(zip)
  const names = Object.keys(files)
  const index = findWebIndex(names)
  if (!index) return null

  const data = (from: string, ref: string) => {
    const p = resolve(from, ref)
    return p ? files[p] : undefined
  }
  const dataUrl = (from: string, ref: string) => {
    const b = data(from, ref)
    return b ? toDataUrl(b, MIME[ext(ref)] ?? 'application/octet-stream') : null
  }
  const inlineCssUrls = (css: string, from: string) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref: string) => {
      const d = dataUrl(from, ref)
      return d ? `url("${d}")` : m
    })

  let html = text(files[index]!)

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    const b = href ? data(index, href) : undefined
    if (!b || !href) return tag
    const from = resolve(index, href) ?? index
    return `<style>${inlineCssUrls(text(b), from)}</style>`
  })

  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, pre: string, src: string, post: string) => {
    const b = data(index, src)
    if (!b) return tag
    const body = text(b).replace(/<\/script/gi, '<\\/script')
    return `<script${pre}${post}>${body}</script>`
  })

  html = html.replace(/(<(?:img|source|video|audio)\b[^>]*\bsrc=)(["'])([^"']+)\2/gi, (m, pre: string, q: string, src: string) => {
    const d = dataUrl(index, src)
    return d ? `${pre}${q}${d}${q}` : m
  })

  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs: string, css: string) => `<style${attrs}>${inlineCssUrls(css, index)}</style>`)

  return html
}
