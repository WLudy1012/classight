import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { speechApi, type Courseware } from '@/shared/api'
import { buildWebHtml } from '@/shared/webBundle'
import { errorMessage } from '@/shared/i18n'
import { Button, Dialog, Spinner, StateView } from '@/shared/ui'
import './preview.css'

type Phase = { name: 'loading' } | { name: 'ready'; url?: string; html?: string } | { name: 'error'; message: string; gone?: boolean }

export function CoursewarePreview({ courseware, onClose }: { courseware: Courseware; onClose: () => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const stage = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setPhase({ name: 'loading' })
    if (courseware.previewMode === 'none') {
      setPhase({ name: 'ready' })
      return
    }
    void (async () => {
      const file = await speechApi.previewCourseware(courseware.id, controller.signal)
      if (courseware.previewMode === 'web') {
        const html = buildWebHtml(new Uint8Array(await file.arrayBuffer()))
        if (!html) throw new Error(t('preview.failedBody'))
        if (!controller.signal.aborted) setPhase({ name: 'ready', html })
      } else if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(file)
        setPhase({ name: 'ready', url: objectUrl })
      }
    })().catch((e) => {
      if (!controller.signal.aborted) setPhase({ name: 'error', message: errorMessage(e), gone: (e as { code?: string }).code === 'resource.not_found' })
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [courseware.id, courseware.previewMode, t])

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.current?.requestFullscreen?.()
  }, [])

  const preview = phase.name === 'ready' ? phase : null
  const canFull = preview && courseware.previewMode !== 'none'

  return (
    <Dialog
      open
      size="full"
      flush
      onClose={onClose}
      title={courseware.originalName}
      actions={
        <>
          {canFull && (
            <Button size="sm" variant="ghost" iconOnly icon={full ? 'fullscreenExit' : 'fullscreen'} aria-label={full ? t('preview.exitFullscreen') : t('preview.fullscreen')} onClick={toggleFull} />
          )}
        </>
      }
    >
      <div ref={stage} className="pv" data-mode={courseware.previewMode}>
        {phase.name === 'loading' && (
          <div className="pv__center">
            <Spinner label={t('preview.loading')} />
            <span>{courseware.conversion === 'converting' ? t('queue.converting') : t('preview.loading')}</span>
          </div>
        )}
        {phase.name === 'error' && (
          <StateView icon="alert" title={phase.gone ? t('preview.gone') : t('preview.failed')} body={phase.gone ? t('preview.goneBody') : phase.message || t('preview.failedBody')} />
        )}
        {preview && courseware.previewMode === 'none' && <StateView icon="file" title={t('preview.none')} />}
        {preview?.url && courseware.previewMode === 'pdf' && <iframe className="pv__frame" title={courseware.originalName} src={preview.url} />}
        {preview?.html && (
          <>
            <iframe className="pv__frame" title={courseware.originalName} srcDoc={preview.html} sandbox="allow-scripts" referrerPolicy="no-referrer" />
            <p className="pv__note">{t('preview.sandboxNote')}</p>
          </>
        )}
        {preview?.url && courseware.previewMode === 'pptx' && <PptxSlides url={preview.url} fallbackName={courseware.originalName} />}
      </div>
    </Dialog>
  )
}

/** Renders a .pptx in the browser, one slide at a time, scaled to the available box. */
export function PptxSlides({ url, fallbackName }: { url: string; fallbackName: string }) {
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
