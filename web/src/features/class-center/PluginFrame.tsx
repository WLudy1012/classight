import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { request, type TransportRequest } from '@/shared/api/client'
import { errorMessage } from '@/shared/i18n'
import { Button, StateView } from '@/shared/ui'

export function pluginUiUrl(id: string, entry: string, generation?: string | null) {
  const prefix = `/api/v1/plugins/${encodeURIComponent(id)}/ui/`
  const pathname = entry.split('?')[0]!
  if (!pathname.startsWith(prefix) || pathname.includes('..') || pathname.includes('\\') || pathname.includes('%') || entry.includes('#')) return null
  const separator = entry.includes('?') ? '&' : '?'
  return `${entry}${separator}generation=${encodeURIComponent(generation ?? '')}`
}

export function isPluginApiPath(id: string, path: unknown): path is string {
  if (typeof path !== 'string' || path.includes('#')) return false
  const pathname = path.split('?')[0]!
  return pathname.startsWith(`/plugins/${encodeURIComponent(id)}/api/`) &&
    !pathname.includes('..') && !pathname.includes('\\') && !pathname.includes('%')
}

export function PluginFrame({ id, entry, generation, title }: { id: string; entry: string; generation?: string | null; title: string }) {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const frame = useRef<HTMLIFrameElement>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const src = pluginUiUrl(id, entry, generation)
  useEffect(() => { setFailed(false) }, [id, entry, generation])
  useEffect(() => {
    const controller = new AbortController()
    const active = new Set<string>()
    const message = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'classight:request') return
      const { requestId, method = 'GET', path, body } = event.data
      if (typeof requestId !== 'string' || requestId.length > 100 || active.has(requestId)) return
      const reply = (result: unknown) => frame.current?.contentWindow?.postMessage({ type: 'classight:response', requestId, ...result as object }, '*')
      if (!isPluginApiPath(id, path) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || active.size >= 16) {
        reply({ ok: false, error: en ? 'Request outside this plugin is not allowed.' : '不允许访问当前插件以外的接口。' })
        return
      }
      active.add(requestId)
      try {
        const data = await request(method as TransportRequest['method'], path, { body, signal: controller.signal })
        if (!controller.signal.aborted) reply({ ok: true, data })
      } catch (error) { if (!controller.signal.aborted) reply({ ok: false, error: errorMessage(error) }) }
      finally { active.delete(requestId) }
    }
    window.addEventListener('message', message)
    return () => { controller.abort(); window.removeEventListener('message', message) }
  }, [id, entry, generation, en, attempt])
  if (!src || failed) return <StateView icon="alert" title={en ? 'Plugin interface unavailable' : '插件界面暂时不可用'} action={src ? <Button onClick={() => { setFailed(false); setAttempt((value) => value + 1) }}>{en ? 'Retry' : '重试'}</Button> : undefined} />
  return <iframe key={`${generation}:${attempt}:${i18n.language}`} ref={frame} className="plugin-frame" title={title} src={src} sandbox="allow-scripts allow-forms allow-downloads" referrerPolicy="no-referrer" onError={() => setFailed(true)} onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'classight:init', pluginId: id, language: i18n.language }, '*')} />
}
