import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { classApi } from '@/shared/api'
import { setLanguage } from '@/shared/i18n'
import { useCoarsePointer, useDocumentTitle, useReducedMotion } from '@/shared/hooks'
import { easeInOutCubic, lerp, smoothstep } from '@/shared/motion'
import { useClassName, useSite } from '@/shared/site'
import { Icon, LinkButton, toast } from '@/shared/ui'
import { AccountMenu } from '@/features/auth/AccountMenu'
import { overviewKey } from '@/features/class-info/ClassInfoView'
import { Cursor, NAME_TARGET_ID, bracketRect } from './cursor/Cursor'
import { registerMagnet, type ScreenRect } from './cursor/magnet'
import { HomeDock } from './HomeDock'
import { InfoSheet } from './InfoSheet'
import { detectQuality, downgrade } from './quality'
import { ParticleScene, SHRINK } from './scene/ParticleScene'
import { runtime, usePhase, useStage } from './stage/store'
import { useStageDriver } from './stage/useStageDriver'
import './home.css'

const FORCED_QUALITY = new URLSearchParams(location.search).has('quality')
const STATIC_FONT = '600 100px "Geist Variable","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif'

/** Name box when the 3D scene is unavailable: same layout rules as ParticleScene. */
function staticBox(text: string, w: number, h: number, p: number, ratio: number): ScreenRect & { font: number } {
  const e = p * p * (3 - 2 * p)
  const wantW = w * (w < 720 ? 0.88 : w < 1100 ? 0.7 : 0.6)
  const fontPx = Math.min(wantW / Math.max(ratio, 0.01), h * 0.18)
  const k = lerp(1, SHRINK, e)
  const bw = fontPx * ratio * k
  const bh = fontPx * 0.9 * k
  const cy = h * lerp(0.295, w < 720 ? 0.12 : 0.105, e)
  void text
  return { x: w / 2 - bw / 2, y: cy - bh / 2, w: bw, h: bh, font: fontPx * k }
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1]!, 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

export default function HomePage() {
  const { t, i18n } = useTranslation()
  const siteQ = useSite()
  const site = siteQ.data
  const className = useClassName(site)
  useDocumentTitle(className)
  const qc = useQueryClient()
  const reduced = useReducedMotion()
  const coarse = useCoarsePointer()

  const phase = usePhase()
  const zone = useStage((s) => s.zone)
  const quality = useStage((s) => s.quality)
  const sceneFailed = useStage((s) => s.sceneFailed)
  const staticMode = quality === 'static' || sceneFailed

  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ParticleScene | null>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const hitRef = useRef<HTMLButtonElement>(null)
  const sloganRef = useRef<HTMLParagraphElement>(null)
  const staticRef = useRef<HTMLDivElement>(null)
  const staticRatio = useRef(4)

  const driver = useStageDriver({
    getScroller: () => scrollerRef.current,
    reducedMotion: reduced,
    alwaysLocked: coarse || staticMode,
  })

  // fresh stage on every visit to the home route
  useEffect(() => {
    useStage.getState().reset()
    return () => useStage.getState().reset()
  }, [])

  // have the class story ready before the user pushes in
  useEffect(() => {
    void qc.prefetchQuery({ queryKey: overviewKey(i18n.language), queryFn: ({ signal }) => classApi.overview(signal) })
  }, [qc, i18n.language])

  // choose a quality tier once the site defaults are known
  const siteDefault = site?.appearance.particleQualityDefault
  useEffect(() => {
    if (!siteDefault) return
    useStage.getState().setQuality(detectQuality(siteDefault, coarse))
  }, [siteDefault, coarse])

  // The page is white: a pale configured particle color would vanish, so fall back to ink.
  const configured = site?.appearance.palette.particle
  const particleColor = configured && luminance(configured) < 0.6 ? configured : '#0b1220'

  /* ---------------- 3D scene lifecycle ---------------- */
  useEffect(() => {
    const container = canvasRef.current
    if (!container || !site || quality === 'static') return
    let cancelled = false
    let warm = 0
    const scene = new ParticleScene({
      container,
      text: className,
      quality,
      color: particleColor,
      calm: reduced,
      coarse,
      onIntroDone: () => useStage.getState().setIntroDone(),
      onFrameTime: (avg) => {
        // the first window includes shader compilation; judge only later ones
        if (warm++ < 1) return
        const q = useStage.getState().quality
        if (avg > 28 && q !== 'low' && q !== 'static' && !FORCED_QUALITY) {
          useStage.getState().setQuality(downgrade(q))
          toast.info(t('home.lowPower'))
        }
      },
    })
    void scene.init().then((ok) => {
      if (cancelled) {
        if (ok) scene.dispose()
        return
      }
      if (!ok) {
        useStage.getState().setSceneFailed()
        useStage.getState().setIntroDone()
        return
      }
      sceneRef.current = scene
    })
    const onResize = () => scene.resize()
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      if (sceneRef.current === scene) sceneRef.current = null
      scene.dispose()
    }
    // t is stable per language; the scene should not rebuild for it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, className, quality, particleColor, reduced, coarse])

  // static mode: no intro to wait for
  useEffect(() => {
    if (staticMode) useStage.getState().setIntroDone()
  }, [staticMode])

  // pointer -> scene (mouse and touch), lock -> scene
  useEffect(() => {
    const move = (e: PointerEvent) => sceneRef.current?.setPointer(e.clientX, e.clientY, true)
    const off = () => sceneRef.current?.setPointer(0, 0, false)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', move, { passive: true })
    window.addEventListener('pointerup', (e) => e.pointerType === 'touch' && off(), { passive: true })
    document.documentElement.addEventListener('mouseleave', off)
    const unsub = useStage.subscribe((s, prev) => {
      if (s.locked !== prev.locked) sceneRef.current?.setLocked(s.locked)
    })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', move)
      document.documentElement.removeEventListener('mouseleave', off)
      unsub()
    }
  }, [])

  /* ---------------- name geometry shared by cursor, hit button and fallback ---------------- */
  const getNameBox = useCallback((): ScreenRect => {
    const scene = sceneRef.current
    if (scene) return scene.getNameBox()
    return staticBox(className, window.innerWidth, window.innerHeight, runtime.progress, staticRatio.current)
  }, [className])

  useEffect(
    () =>
      registerMagnet({
        id: NAME_TARGET_ID,
        kind: 'scene',
        getScreenRect: () => (useStage.getState().introDone ? getNameBox() : null),
        radius: 90,
        priority: 3,
        pad: 16,
      }),
    [getNameBox],
  )

  // measure the static name once so the fallback can size itself
  useEffect(() => {
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return
    c.font = STATIC_FONT
    staticRatio.current = c.measureText(className).width / 100
  }, [className])

  const getSheetRect = useCallback((): ScreenRect | null => {
    const el = sheetRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [])

  /* ---------------- per-frame DOM sync (no React renders) ---------------- */
  useEffect(() => {
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const p = runtime.progress
      const box = getNameBox()

      rootRef.current?.style.setProperty('--p', String(p))
      const slogan = sloganRef.current
      if (slogan) slogan.style.transform = `translate3d(-50%, ${box.y + box.h + 30}px, 0)`
      const hit = hitRef.current
      if (hit) {
        hit.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`
        hit.style.width = `${box.w}px`
        hit.style.height = `${box.h}px`
      }

      const st = staticRef.current
      if (st && !sceneRef.current) {
        const b = staticBox(className, window.innerWidth, window.innerHeight, p, staticRatio.current)
        st.style.transform = `translate3d(${b.x + b.w / 2}px, ${b.y + b.h / 2}px, 0) translate(-50%, -50%)`
        st.style.fontSize = `${b.font}px`
      }

      const sheet = sheetRef.current
      if (sheet) {
        if (p <= 0.001) {
          sheet.style.visibility = 'hidden'
        } else {
          sheet.style.visibility = 'visible'
          sheet.style.opacity = String(smoothstep(0.05, 0.55, p))
          if (p >= 0.999) {
            sheet.style.clipPath = 'none'
          } else {
            const sr = sheet.getBoundingClientRect()
            let b: ScreenRect
            if (bracketRect.active) {
              b = bracketRect
            } else {
              const e = easeInOutCubic(smoothstep(0.02, 0.98, p))
              b = {
                x: lerp(box.x, sr.left, e),
                y: lerp(box.y, sr.top, e),
                w: lerp(box.w, sr.width, e),
                h: lerp(box.h, sr.height, e),
              }
            }
            const top = Math.max(0, b.y - sr.top)
            const left = Math.max(0, b.x - sr.left)
            const right = Math.max(0, sr.right - (b.x + b.w))
            const bottom = Math.max(0, sr.bottom - (b.y + b.h))
            sheet.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px round 18px)`
          }
        }
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [getNameBox, className])

  const openAt = useCallback(
    (id?: string) => {
      driver.open()
      if (id)
        window.setTimeout(() => {
          scrollerRef.current?.querySelector(`#${id}`)?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
        }, 900)
    },
    [driver, reduced],
  )

  /* ---------------- chrome ---------------- */
  const otherLang = i18n.language === 'en' ? 'zh' : 'en'
  const hint = useMemo(() => {
    if (phase === 'locked') return coarse ? t('home.hintTouch') : t('home.hintDesktop')
    if (phase === 'idle') return coarse ? t('home.hintTouch') : t('home.stage.idle')
    return ''
  }, [phase, coarse, t])

  const hasBracket = !coarse
  const ready = !!site

  return (
    <div
      ref={rootRef}
      className="home"
      data-zone={zone}
      data-phase={phase}
      data-bracket={hasBracket}
      data-static={staticMode}
      data-ready={ready}
    >
      {!staticMode && <div ref={canvasRef} className="home__canvas" aria-hidden="true" />}
      <h1 className="sr-only">{className}</h1>
      {staticMode && ready && (
        <div ref={staticRef} className="home__static-name" aria-hidden="true">
          {className}
        </div>
      )}

      <button
        ref={hitRef}
        type="button"
        className="home__hit"
        data-name-hit
        tabIndex={ready ? 0 : -1}
        aria-label={zone === 'info' ? t('home.back') : `${className}: ${t('home.hintButton')}`}
        onClick={() => (zone === 'info' ? driver.close() : driver.open())}
        onFocus={() => zone === 'home' && useStage.getState().setLocked(true)}
        onBlur={() => zone === 'home' && useStage.getState().setLocked(false)}
        hidden={!ready}
      />

      {ready && site?.slogan && (
        <p ref={sloganRef} className="home__slogan">
          {site.slogan}
        </p>
      )}
      {ready && <HomeDock visible={zone === 'home'} onOpen={openAt} />}

      <header className="home__tr">
        <AccountMenu />
      </header>

      <div className="home__bl">
        <button
          className="btn btn-ghost lang"
          data-magnet
          data-magnet-pad="5"
          onClick={() => setLanguage(otherLang)}
          aria-label={`${t('common.language')}: ${otherLang === 'en' ? 'English' : '中文'}`}
        >
          <Icon name="globe" />
          {otherLang === 'en' ? 'EN' : '中文'}
        </button>
      </div>

      <div className="home__br">
        <LinkButton
          to="/console"
          variant="primary"
          size="lg"
          iconRight="arrowRight"
          data-magnet
          data-magnet-priority="2"
          data-magnet-pad="6"
          aria-label={t('home.startAria')}
        >
          {t('home.start')}
        </LinkButton>
      </div>

      <p className="home__hint" data-show={hint !== '' && zone === 'home'} aria-live="polite" key={hint}>
        {hint}
      </p>
      {staticMode && ready && sceneFailed && <p className="home__note">{t('home.fallbackNote')}</p>}

      <InfoSheet ref={sheetRef} open={zone === 'info'} onClose={driver.close} scrollerRef={scrollerRef} />

      {hasBracket && <Cursor getSheetRect={getSheetRect} />}
    </div>
  )
}
