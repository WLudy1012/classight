/**
 * Motion tokens. All animation references names from here; no scattered curve literals.
 * CSS equivalents live in styles/tokens.css (--ease-*). Springs are for JS-driven motion.
 */
export interface SpringSpec {
  stiffness: number
  damping: number
  mass?: number
}

export const springs = {
  /** bracket following the pointer: visible inertia, soft landing */
  follow: { stiffness: 130, damping: 15 },
  /** bracket locking onto a target: quick, barely overshoots */
  snap: { stiffness: 300, damping: 27 },
  /** bracket leaning toward the pointer while snapped: loose enough to feel held, not stuck */
  lean: { stiffness: 190, damping: 22 },
  /** wheel-driven stage progress: heavy and smooth */
  progress: { stiffness: 78, damping: 17.5 },
  /** commit after the wheel stops: settles with a slight give */
  commit: { stiffness: 64, damping: 14 },
} satisfies Record<string, SpringSpec>

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** One spring-integrated scalar. Semi-implicit Euler in fixed substeps: stable at any frame rate. */
export class Spring {
  value: number
  velocity = 0
  target: number
  constructor(value = 0, public spec: SpringSpec = springs.follow) {
    this.value = value
    this.target = value
  }
  snapTo(v: number) {
    this.value = this.target = v
    this.velocity = 0
  }
  step(dt: number) {
    const { stiffness, damping, mass = 1 } = this.spec
    const h = 1 / 240
    let t = Math.min(dt, 1 / 20)
    while (t > 1e-6) {
      const s = Math.min(h, t)
      const a = (-stiffness * (this.value - this.target) - damping * this.velocity) / mass
      this.velocity += a * s
      this.value += this.velocity * s
      t -= s
    }
    return this.value
  }
  get settled() {
    return Math.abs(this.value - this.target) < 0.001 && Math.abs(this.velocity) < 0.001
  }
}
