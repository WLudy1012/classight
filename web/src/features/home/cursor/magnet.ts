/**
 * MagnetRegistry: anything the four-corner cursor can snap to.
 * DOM elements opt in with `data-magnet` (+ optional data-magnet-radius / -priority / -pad);
 * the 3D class name registers a `scene` target whose rect is projected to the screen every frame.
 */
export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MagnetTarget {
  id: string
  kind: 'dom' | 'scene'
  getScreenRect: () => ScreenRect | null
  /** snap distance from the rect edge, px */
  radius: number
  /** higher wins when several are in range */
  priority: number
  /** px the bracket stays outside the rect */
  pad: number
  onSnap?: () => void
  onRelease?: () => void
}

const targets = new Map<string, MagnetTarget>()

export function registerMagnet(t: MagnetTarget): () => void {
  targets.set(t.id, t)
  return () => {
    if (targets.get(t.id) === t) targets.delete(t.id)
  }
}

export const getSceneTargets = () => [...targets.values()]

/* ---- DOM scan: keeps a cached list of [data-magnet] elements, refreshed on mutation ---- */
let domTargets: MagnetTarget[] = []
let observer: MutationObserver | null = null

function rebuildDom() {
  domTargets = [...document.querySelectorAll<HTMLElement>('[data-magnet]')].map((el, i) => ({
    id: `dom:${el.id || i}`,
    kind: 'dom' as const,
    getScreenRect: () => {
      if (!el.isConnected) return null
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return null
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.pointerEvents === 'none') return null
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    },
    radius: Number(el.dataset.magnetRadius ?? 48),
    priority: Number(el.dataset.magnetPriority ?? 1),
    pad: Number(el.dataset.magnetPad ?? 6),
  }))
}

export function startDomScan(): () => void {
  rebuildDom()
  observer = new MutationObserver(rebuildDom)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-magnet', 'hidden'] })
  window.addEventListener('resize', rebuildDom)
  return () => {
    observer?.disconnect()
    window.removeEventListener('resize', rebuildDom)
    domTargets = []
  }
}

export const getAllTargets = () => [...domTargets, ...targets.values()]
