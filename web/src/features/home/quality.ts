import type { QualityTier } from '@/shared/api'

const ORDER: QualityTier[] = ['static', 'low', 'medium', 'high']
const KEY = 'classight.quality.cap'

const min = (a: QualityTier, b: QualityTier) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b)

export function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** Pick a starting tier from the site default, then cap it by what the device can plausibly do. */
export function detectQuality(siteDefault: QualityTier, coarse: boolean): QualityTier {
  // ?quality=high|medium|low|static pins the tier (QA, and a manual escape hatch for odd GPUs)
  const forced = new URLSearchParams(location.search).get('quality') as QualityTier | null
  if (forced && ORDER.includes(forced)) return forced
  if (!hasWebGL2()) return 'static'
  let tier = siteDefault
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = nav.hardwareConcurrency ?? 8
  const mem = nav.deviceMemory ?? 8
  if (coarse) tier = min(tier, 'medium')
  if (cores <= 4 || mem <= 4) tier = min(tier, 'medium')
  if (mem <= 2) tier = min(tier, 'low')
  try {
    const cap = sessionStorage.getItem(KEY) as QualityTier | null
    if (cap && ORDER.includes(cap)) tier = min(tier, cap)
  } catch {
    /* noop */
  }
  return tier
}

/** Next tier down, remembered for the session so a slow device does not re-learn it on every visit. */
export function downgrade(tier: QualityTier): QualityTier {
  const next = ORDER[Math.max(0, ORDER.indexOf(tier) - 1)]!
  try {
    sessionStorage.setItem(KEY, next)
  } catch {
    /* noop */
  }
  return next
}
