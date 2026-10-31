import { useEffect, useRef } from 'react'
import { Spring, clamp, easeInOutCubic, lerp, springs, smoothstep, type SpringSpec } from '@/shared/motion'
import { runtime, useStage } from '../stage/store'
import { getAllTargets, startDomScan, type MagnetTarget, type ScreenRect } from './magnet'
import './cursor.css'

/** Shared with the info sheet so it can clip itself to the bracket as it opens. */
export const bracketRect: ScreenRect & { active: boolean } = { x: 0, y: 0, w: 0, h: 0, active: false }

export const NAME_TARGET_ID = 'scene:name'

interface Props {
  /** Rect the bracket grows into at progress 1 (the info sheet). */
  getSheetRect: () => ScreenRect | null
}

const IDLE_SIZE = 34
/** pointer dot diameter, px (keep in sync with .bracket-dot) */
const DOT = 8

export function Cursor({ getSheetRect }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const dot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    const dotEl = dot.current
    if (!el || !dotEl) return
    const stopScan = startDomScan()

    const sx = new Spring(0, springs.follow)
    const sy = new Spring(0, springs.follow)
    const sw = new Spring(IDLE_SIZE, springs.follow)
    const sh = new Spring(IDLE_SIZE, springs.follow)
    let snapped: MagnetTarget | null = null
    let pressed = false
    let visible = false
    let ready = false
    let last = performance.now()
    let raf = 0

    const setSpec = (spec: SpringSpec) => {
      sx.spec = sy.spec = sw.spec = sh.spec = spec
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      runtime.pointer = { x: e.clientX, y: e.clientY }
      if (!ready) {
        sx.snapTo(e.clientX - IDLE_SIZE / 2)
        sy.snapTo(e.clientY - IDLE_SIZE / 2)
        ready = true
      }
    }
    const onLeave = () => {
      runtime.pointer = null
    }
    const onDown = () => (pressed = true)
    const onUp = () => (pressed = false)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)

    const distToRect = (px: number, py: number, r: ScreenRect) => {
      const dx = Math.max(r.x - px, 0, px - (r.x + r.w))
      const dy = Math.max(r.y - py, 0, py - (r.y + r.h))
      return Math.hypot(dx, dy)
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min((now - last) / 1000, 1 / 20)
      last = now
      const p = runtime.progress
      const e = easeInOutCubic(smoothstep(0.02, 0.98, p))
      const ptr = runtime.pointer
      const inInfo = p > 0.995

      // ---- choose a snap target (held while the stage is advancing) ----
      let rect: ScreenRect | null = null
      if (p > 0.002 && snapped) {
        rect = snapped.getScreenRect()
      } else if (ptr) {
        let best: MagnetTarget | null = null
        let bestScore = Infinity
        let bestRect: ScreenRect | null = null
        for (const t of getAllTargets()) {
          const r = t.getScreenRect()
          if (!r) continue
          const d = distToRect(ptr.x, ptr.y, r)
          const reach = t === snapped ? t.radius * 1.5 : t.radius
          if (d > reach) continue
          const score = d - t.priority * 8
          if (score < bestScore) {
            best = t
            bestScore = score
            bestRect = r
          }
        }
        if (best !== snapped) {
          snapped?.onRelease?.()
          snapped = best
          snapped?.onSnap?.()
          useStage.getState().setLocked(snapped?.id === NAME_TARGET_ID)
        }
        rect = bestRect
      } else if (snapped && p <= 0.002) {
        snapped.onRelease?.()
        snapped = null
        useStage.getState().setLocked(false)
      }

      // ---- spring targets ----
      let mode: 'idle' | 'snapped' | 'expanding' | 'frame' = 'idle'
      if (snapped && rect) {
        const pad = snapped.pad - (pressed && p === 0 ? 3 : 0)
        // Snapped is not frozen: the bracket leans a few px toward the pointer, like a held magnet.
        let lx = 0
        let ly = 0
        if (ptr && p === 0) {
          const reach = Math.max(snapped.radius, 24)
          const max = Math.min(14, Math.max(4, Math.min(rect.w, rect.h) * 0.1))
          lx = clamp((ptr.x - (rect.x + rect.w / 2)) / (rect.w / 2 + reach), -1, 1) * max
          ly = clamp((ptr.y - (rect.y + rect.h / 2)) / (rect.h / 2 + reach), -1, 1) * max
        }
        const nameRect: ScreenRect = { x: rect.x - pad + lx, y: rect.y - pad + ly, w: rect.w + pad * 2, h: rect.h + pad * 2 }
        const sheet = p > 0 ? getSheetRect() : null
        if (sheet && p > 0) {
          sx.target = lerp(nameRect.x, sheet.x, e)
          sy.target = lerp(nameRect.y, sheet.y, e)
          sw.target = lerp(nameRect.w, sheet.w, e)
          sh.target = lerp(nameRect.h, sheet.h, e)
          mode = inInfo ? 'frame' : 'expanding'
        } else {
          sx.target = nameRect.x
          sy.target = nameRect.y
          sw.target = nameRect.w
          sh.target = nameRect.h
          mode = 'snapped'
        }
        setSpec(p > 0 ? { stiffness: 420, damping: 40 } : springs.lean)
      } else if (ptr) {
        const s = IDLE_SIZE * (pressed ? 0.78 : 1)
        sx.target = ptr.x - s / 2
        sy.target = ptr.y - s / 2
        sw.target = s
        sh.target = s
        setSpec(springs.follow)
      }

      sx.step(dt)
      sy.step(dt)
      sw.step(dt)
      sh.step(dt)

      const w = Math.max(8, sw.value)
      const h = Math.max(8, sh.value)
      bracketRect.x = sx.value
      bracketRect.y = sy.value
      bracketRect.w = w
      bracketRect.h = h
      bracketRect.active = mode === 'expanding' || mode === 'frame'

      const show = !!ptr || (snapped !== null && p > 0)
      if (show !== visible) {
        visible = show
        el.dataset.visible = String(show)
      }
      el.dataset.mode = mode
      el.style.transform = `translate3d(${sx.value.toFixed(2)}px, ${sy.value.toFixed(2)}px, 0)`
      el.style.width = `${w.toFixed(2)}px`
      el.style.height = `${h.toFixed(2)}px`
      el.style.setProperty('--arm', `${Math.min(18, Math.max(7, Math.min(w, h) * 0.3)).toFixed(1)}px`)

      // The bracket is snapped to a target and no longer shows where the pointer is, so a white dot marks the real position.
      // It follows the pointer exactly (no spring) and hides once the sheet is fully open and the system cursor returns.
      if (ptr) dotEl.style.transform = `translate3d(${ptr.x - DOT / 2}px, ${ptr.y - DOT / 2}px, 0) scale(${pressed ? 0.8 : 1})`
      dotEl.dataset.on = String(!!ptr && !inInfo)
      dotEl.dataset.mode = mode
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      stopScan()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      runtime.pointer = null
      bracketRect.active = false
      useStage.getState().setLocked(false)
    }
  }, [getSheetRect])

  return (
    <>
      <div ref={root} className="bracket" data-visible="false" data-mode="idle" aria-hidden="true">
        <i className="bracket__c bracket__c--tl" />
        <i className="bracket__c bracket__c--tr" />
        <i className="bracket__c bracket__c--bl" />
        <i className="bracket__c bracket__c--br" />
      </div>
      <div ref={dot} className="bracket-dot" data-on="false" aria-hidden="true" />
    </>
  )
}
