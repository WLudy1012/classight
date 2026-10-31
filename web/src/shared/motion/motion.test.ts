import { describe, expect, it } from 'vitest'
import { Spring, clamp, easeInOutCubic, smoothstep, springs } from '.'

describe('Spring', () => {
  it('settles on its target without exploding at coarse frame rates', () => {
    const s = new Spring(0, springs.snap)
    s.target = 100
    for (let i = 0; i < 120; i++) s.step(1 / 20) // 20fps worst case
    expect(s.value).toBeCloseTo(100, 1)
    expect(s.settled).toBe(true)
  })

  it('follow spring lags the target (visible inertia)', () => {
    const s = new Spring(0, springs.follow)
    s.target = 100
    s.step(1 / 60)
    expect(s.value).toBeGreaterThan(0)
    expect(s.value).toBeLessThan(10)
  })

  it('progress spring never settles outside 0..1 when clamped by the driver', () => {
    const s = new Spring(0, springs.progress)
    s.target = 1
    let max = 0
    for (let i = 0; i < 400; i++) max = Math.max(max, s.step(1 / 60))
    expect(max).toBeLessThan(1.08) // slight give, never a bounce
  })
})

describe('easing helpers', () => {
  it('clamp / smoothstep / easeInOutCubic bounds', () => {
    expect(clamp(5)).toBe(1)
    expect(clamp(-1)).toBe(0)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5)
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5)
  })
})
