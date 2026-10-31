import { create } from 'zustand'
import type { QualityTier } from '@/shared/api'

/**
 * Single source of truth for the home page. 3D scene, cursor and DOM only subscribe.
 * Discrete state lives in the zustand store (re-renders React); per-frame values live in
 * `runtime` (mutable, read from rAF loops).
 */
export type Phase = 'intro' | 'idle' | 'locked' | 'transitioning' | 'info'

export const runtime = {
  /** smoothed progress 0..1 (0 = home, 1 = class information) */
  progress: 0,
  /** where the wheel/keys want progress to go */
  target: 0,
  /** which resting state a gesture started from; used for commit thresholds */
  anchor: 0 as 0 | 1,
  /** pointer in client px; null when it has left the window or is touch */
  pointer: null as { x: number; y: number } | null,
}

interface StageState {
  introDone: boolean
  locked: boolean
  /** progress bucket, derived from runtime.progress by the driver */
  zone: 'home' | 'between' | 'info'
  quality: QualityTier
  /** scene could not start (no WebGL2 / float targets) */
  sceneFailed: boolean
  setIntroDone: () => void
  setLocked: (v: boolean) => void
  setZone: (z: StageState['zone']) => void
  setQuality: (q: QualityTier) => void
  setSceneFailed: () => void
  reset: () => void
}

export const useStage = create<StageState>((set) => ({
  introDone: false,
  locked: false,
  zone: 'home',
  quality: 'high',
  sceneFailed: false,
  setIntroDone: () => set({ introDone: true }),
  setLocked: (locked) => set({ locked }),
  setZone: (zone) => set({ zone }),
  setQuality: (quality) => set({ quality }),
  setSceneFailed: () => set({ sceneFailed: true }),
  reset: () => {
    runtime.progress = 0
    runtime.target = 0
    runtime.anchor = 0
    set({ introDone: false, locked: false, zone: 'home', sceneFailed: false })
  },
}))

export function derivePhase(s: Pick<StageState, 'introDone' | 'locked' | 'zone'>): Phase {
  if (s.zone === 'info') return 'info'
  if (s.zone === 'between') return 'transitioning'
  if (!s.introDone) return 'intro'
  return s.locked ? 'locked' : 'idle'
}

export const usePhase = (): Phase => useStage((s) => derivePhase(s))
