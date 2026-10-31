import { useEffect, useRef } from 'react'
import { Spring, clamp, springs } from '@/shared/motion'
import { runtime, useStage } from './store'

interface Options {
  /** the scrollable region of the info sheet (wheel inside it scrolls it, unless it is at the top) */
  getScroller: () => HTMLElement | null
  reducedMotion: boolean
  /** keep the stage on the name even without a cursor lock (touch, keyboard, static mode) */
  alwaysLocked: boolean
}

const WHEEL_UNIT = 760 // px of wheel travel for the full 0 -> 1 push
const IDLE_COMMIT_MS = 150
const COMMIT_THRESHOLD = 0.16

/**
 * Turns wheel / touch / keys into `runtime.target`, springs `runtime.progress` toward it, and
 * publishes the coarse zone (home | between | info). Returns imperative controls for buttons.
 */
export function useStageDriver({ getScroller, reducedMotion, alwaysLocked }: Options) {
  const opts = useRef({ getScroller, reducedMotion, alwaysLocked })
  opts.current = { getScroller, reducedMotion, alwaysLocked }
  const api = useRef({
    open: () => {},
    close: () => {},
  })

  useEffect(() => {
    const spring = new Spring(runtime.progress, springs.progress)
    let commitTimer = 0
    let burstAt = 0
    let burstMode: 'stage' | 'native' = 'native'
    let raf = 0
    let last = performance.now()

    const setSpring = (committing: boolean) => {
      spring.spec = opts.current.reducedMotion
        ? { stiffness: 520, damping: 46 }
        : committing
          ? springs.commit
          : springs.progress
    }

    const commit = (to: 0 | 1) => {
      setSpring(true)
      runtime.target = to
      runtime.anchor = to
    }

    const scheduleCommit = () => {
      window.clearTimeout(commitTimer)
      commitTimer = window.setTimeout(() => {
        const t = runtime.target
        if (runtime.anchor === 0) commit(t > COMMIT_THRESHOLD ? 1 : 0)
        else commit(t < 1 - COMMIT_THRESHOLD ? 0 : 1)
      }, IDLE_COMMIT_MS)
    }

    const canStartPush = () => useStage.getState().locked || opts.current.alwaysLocked

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return // pinch-zoom
      const now = performance.now()
      const scroller = opts.current.getScroller()
      const zone = useStage.getState().zone
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY

      if (now - burstAt > 170) {
        // a fresh gesture: decide once whether it drives the stage or scrolls the sheet
        if (zone === 'info') {
          const atTop = !scroller || scroller.scrollTop <= 0
          burstMode = atTop && dy < 0 ? 'stage' : 'native'
        } else if (zone === 'home') {
          burstMode = dy > 0 && canStartPush() ? 'stage' : 'native'
        } else {
          burstMode = 'stage'
        }
      }
      burstAt = now
      if (burstMode === 'native') return

      e.preventDefault()
      setSpring(false)
      runtime.target = clamp(runtime.target + dy / WHEEL_UNIT)
      scheduleCommit()
    }

    // touch: swipe up on the stage pushes in; pulling down at the top of the sheet pulls out
    let touchY = 0
    let touchMode: 'stage' | 'native' | null = null
    let touchBase = 0
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      touchY = touch.clientY
      touchBase = runtime.target
      const scroller = opts.current.getScroller()
      const zone = useStage.getState().zone
      touchMode = null
      if (zone === 'info' && scroller && scroller.scrollTop > 0) touchMode = 'native'
      if (zone === 'info' && scroller && (e.target as Node) && !scroller.contains(e.target as Node)) touchMode = 'stage'
    }
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      const dy = touchY - touch.clientY // positive = swipe up
      const zone = useStage.getState().zone
      if (touchMode === null) {
        if (Math.abs(dy) < 6) return
        if (zone === 'home') touchMode = dy > 0 ? 'stage' : 'native'
        else if (zone === 'info') {
          const scroller = opts.current.getScroller()
          touchMode = dy < 0 && (!scroller || scroller.scrollTop <= 0) ? 'stage' : 'native'
        } else touchMode = 'stage'
      }
      if (touchMode !== 'stage') return
      if (e.cancelable) e.preventDefault()
      setSpring(false)
      runtime.target = clamp(touchBase + dy / 340)
    }
    const onTouchEnd = () => {
      if (touchMode === 'stage') scheduleCommit()
      touchMode = null
    }

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      if (typing) return
      const zone = useStage.getState().zone
      const onControl = !!el && /^(BUTTON|A)$/.test(el.tagName) && !el.hasAttribute('data-name-hit')
      if (e.key === 'Escape' && zone !== 'home') {
        e.preventDefault()
        commit(0)
      } else if ((e.key === 'ArrowDown' || e.key === 'PageDown') && zone === 'home' && !onControl) {
        e.preventDefault()
        commit(1)
      } else if ((e.key === 'ArrowUp' || e.key === 'PageUp') && zone === 'info' && !onControl) {
        const scroller = opts.current.getScroller()
        if (!scroller || scroller.scrollTop <= 0) {
          e.preventDefault()
          commit(0)
        }
      }
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min((now - last) / 1000, 1 / 20)
      last = now
      spring.target = runtime.target
      spring.step(dt)
      // the sheet must never over/undershoot its own frame
      const v = clamp(spring.value)
      if (v !== spring.value) {
        spring.value = v
        spring.velocity = 0
      }
      const settled = Math.abs(v - runtime.target) < 0.0015 && Math.abs(spring.velocity) < 0.01
      runtime.progress = settled ? runtime.target : v
      const zone: 'home' | 'between' | 'info' =
        runtime.progress <= 0.001 ? 'home' : runtime.progress >= 0.999 ? 'info' : 'between'
      if (useStage.getState().zone !== zone) useStage.getState().setZone(zone)
    }
    raf = requestAnimationFrame(tick)

    api.current.open = () => commit(1)
    api.current.close = () => commit(0)

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(commitTimer)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return {
    open: () => api.current.open(),
    close: () => api.current.close(),
  }
}
