import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { speechApi, type Courseware, type PreviewTicket } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Button, Dialog, Icon, Spinner, StateView } from '@/shared/ui'
import { downloadCourseware } from './download'
import './preview.css'

type Phase = { name: 'loading' } | { name: 'ready'; ticket: PreviewTicket } | { name: 'error'; message: string; gone?: boolean }

/** The ticket URL is relative to the site root, so it works against the real backend and the Vite proxy alike. */
const absolute = (url: string) => (/^(blob:|data:|https?:)/.test(url) ? url : new URL(url, window.location.origin).toString())

export function CoursewarePreview({ courseware, onClose }: { courseware: Courseware; onClose: () => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const stage = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPhase({ name: 'loading' })
    speechApi
      .previewTicket(courseware.id)
      .then((ticket) => !cancelled && setPhase({ name: 'ready', ticket }))
      .catch((e) => !cancelled && setPhase({ name: 'error', message: errorMessage(e), gone: (e as { code?: string }).code === 'resource.not_found' }))
    return () => {
      cancelled = true
    }
  }, [courseware.id, courseware.conversion])

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }, [])

  const ticket = phase.name === 'ready' ? phase.ticket : null
  const canFull = ticket && ticket.mode !== 'none'

  return (
    <Dialog
      open
      size="full"
      flush
      onClose={onClose}
      title={courseware.originalName}
      actions={
        <>
          {ticket?.mode === 'web' && (
            <a className="btn btn-ghost btn-sm" href={absolute(ticket.url)} target="_blank" rel="noopener noreferrer">
              <Icon name="externalLink" /> {t('preview.openNew')}
            </a>
          )}
          <Button size="sm" variant="ghost" icon="download" onClick={() => void downloadCourseware(courseware)}>
            {t('queue.download')}
          </Button>
          {canFull && (
            <Button size="sm" variant="ghost" iconOnly icon={full ? 'fullscreenExit' : 'fullscreen'} aria-label={full ? t('preview.exitFullscreen') : t('preview.fullscreen')} onClick={toggleFull} />
          )}
        </>
      }
    >
      <div ref={stage} className="pv" data-mode={ticket?.mode}>
        {phase.name === 'loading' && (
          <div className="pv__center">
            <Spinner label={t('preview.loading')} />
            <span>{courseware.conversion === 'converting' ? t('queue.converting') : t('preview.loading')}</span>
          </div>
        )}
        {phase.name === 'error' && (
          <StateView icon="alert" title={phase.gone ? t('preview.gone') : t('preview.failed')} body={phase.gone ? t('preview.goneBody') : phase.message || t('preview.failedBody')} />
        )}
        {ticket?.mode === 'none' && <StateView icon="file" title={t('preview.none')} body={t('preview.noneBody')} />}
        {ticket?.mode === 'pdf' && <iframe className="pv__frame" title={courseware.originalName} src={absolute(ticket.url)} />}
        {ticket?.mode === 'web' && (
          // No allow-same-origin: the page runs in an opaque origin and cannot touch this app's memory, cookies or API.
          <>
            <iframe className="pv__frame" title={courseware.originalName} src={absolute(ticket.url)} sandbox="allow-scripts" referrerPolicy="no-referrer" />
            <p className="pv__note">{t('preview.sandboxNote')}</p>
          </>
        )}
        {ticket?.mode === 'pptx' && <PptxSlides url={absolute(ticket.url)} fallbackName={courseware.originalName} />}
      </div>
    </Dialog>
  )
}

/** Renders a .pptx in the browser, one slide at a time, scaled to the available box. */
function PptxSlides({ url, fallbackName }: { url: string; fallbackName: string }) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<{ slideCount: number; currentIndex: number; renderNextSlide(): void; renderPreSlide(): void; renderSingleSlide(i: number): void; destroy(): void } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const buffer = await res.arrayBuffer()
        const { init } = await import('pptx-preview')
        if (cancelled || !host.current) return
        host.current.innerHTML = ''
        const v = init(host.current, { width: 960, height: 540, mode: 'slide' })
        await v.preview(buffer)
        if (cancelled) return v.destroy()
        viewer.current = v as unknown as NonNullable<typeof viewer.current>
        setTotal(v.slideCount)
        setIndex(v.currentIndex)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
      try {
        viewer.current?.destroy()
      } catch {
        /* the viewer may already be gone */
      }
      viewer.current = null
    }
  }, [url])

  // keep the 960x540 slide fitted to whatever room the dialog (or fullscreen) gives it
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.max(0.2, Math.min(el.clientWidth / 960, (el.clientHeight - 56) / 540)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state])

  const go = (dir: 1 | -1) => {
    const v = viewer.current
    if (!v) return
    if (dir === 1 && v.currentIndex < v.slideCount - 1) v.renderNextSlide()
    else if (dir === -1 && v.currentIndex > 0) v.renderPreSlide()
    setIndex(v.currentIndex)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (state === 'error') return <StateView icon="alert" title={t('preview.failed')} body={`${t('preview.failedBody')} (${fallbackName})`} />
  return (
    <div className="pv__pptx" ref={box}>
      {state === 'loading' && (
        <div className="pv__center">
          <Spinner label={t('preview.loading')} />
          <span>{t('preview.loading')}</span>
        </div>
      )}
      <div className="pv__slide" style={{ width: 960 * scale, height: 540 * scale, visibility: state === 'ready' ? 'visible' : 'hidden' }}>
        <div ref={host} className="pv__host" style={{ transform: `scale(${scale})` }} />
      </div>
      {state === 'ready' && (
        <div className="pv__bar">
          <Button size="sm" variant="ghost" iconOnly icon="chevronLeft" aria-label={t('preview.prev')} disabled={index <= 0} onClick={() => go(-1)} />
          <span className="num" aria-live="polite">
            {t('preview.page', { page: index + 1, total })}
          </span>
          <Button size="sm" variant="ghost" iconOnly icon="chevronRight" aria-label={t('preview.next')} disabled={index >= total - 1} onClick={() => go(1)} />
        </div>
      )}
    </div>
  )
}
