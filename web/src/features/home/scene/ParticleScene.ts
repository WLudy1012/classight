import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FloatType,
  HalfFloatType,
  PerspectiveCamera,
  Points,
  Scene,
  type TextureDataType,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import type { QualityTier } from '@/shared/api'
import { easeOutExpo, lerp, smoothstep } from '@/shared/motion'
import { runtime } from '../stage/store'
import { dustFragment, dustVertex, pointsFragment, pointsVertex, positionShader, velocityShader } from './shaders'
import { ensureFonts, sampleText } from './textPoints'

export interface SceneOptions {
  /** the scene owns its canvas: a lost WebGL context cannot be reused, so each scene gets a fresh one */
  container: HTMLElement
  text: string
  quality: Exclude<QualityTier, 'static'>
  color: string
  /** prefers-reduced-motion: no autonomous drift, no intro; the pointer still moves particles */
  calm: boolean
  coarse: boolean
  onFrameTime?: (avgMs: number) => void
  onIntroDone?: () => void
}

const TIERS = {
  high: { w: 256, h: 128, size: 1.85, dpr: 2 },
  medium: { w: 128, h: 128, size: 2.3, dpr: 1.5 },
  low: { w: 96, h: 64, size: 2.6, dpr: 1 },
} as const

/** how small the name ends up once the sheet is open (shared with the static fallback) */
export const SHRINK = 0.5
const FOV = 38
const CAM_Z = 16
const VIS_H = 2 * CAM_Z * Math.tan((FOV * Math.PI) / 360)

export interface ScreenBox {
  x: number
  y: number
  w: number
  h: number
}

/** The class name as a physical body of particles. Framework-free; React only owns the canvas. */
export class ParticleScene {
  private renderer!: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 80)
  private gpu!: GPUComputationRenderer
  private velVar!: ReturnType<GPUComputationRenderer['addVariable']>
  private posVar!: ReturnType<GPUComputationRenderer['addVariable']>
  private pointsMat!: ShaderMaterial
  private dustMat?: ShaderMaterial
  private raf = 0
  private last = 0
  private t = 0
  private introT = 0
  private introFired = false
  private disposed = false
  private frameTimes: number[] = []
  private width = 1
  private height = 1
  private aspect = 0.2
  private fit = 8
  private mouse = new Vector3(999, 999, 0)
  private mouseOn = 0
  private mouseTarget = 0
  private boost = 0
  private boostTarget = 0
  private pointerNdc = new Vector2()
  private viewW = 1
  private ppu = 1
  private center = new Vector3()
  private scale = 1
  private sizeBase = 1
  private running = false
  private canvas!: HTMLCanvasElement

  constructor(private o: SceneOptions) {}

  /** Returns false when the device cannot run the GPGPU path (caller falls back to static). */
  async init(): Promise<boolean> {
    const { quality } = this.o
    const tier = TIERS[quality]
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    this.canvas = canvas
    try {
      await ensureFonts(this.o.text)
      this.o.container.appendChild(canvas)
      this.renderer = new WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' })
    } catch {
      canvas.remove()
      return false
    }
    if (!this.renderer.capabilities.isWebGL2) {
      this.renderer.dispose()
      canvas.remove()
      return false
    }
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.dpr))
    this.camera.position.set(0, 0, CAM_Z)

    const count = tier.w * tier.h
    const cloud = sampleText(this.o.text, count)
    this.aspect = cloud.aspect
    const initialWidth = canvas.clientWidth || window.innerWidth
    const initialHeight = canvas.clientHeight || window.innerHeight
    const initialViewWidth = VIS_H * (initialWidth / initialHeight)
    const initialFit = Math.min(
      initialViewWidth * (initialWidth < 720 ? 0.88 : initialWidth < 1100 ? 0.7 : 0.6),
      (VIS_H * 0.3) / Math.max(this.aspect, 0.05),
    )
    const initialY = VIS_H * (initialHeight < 560 ? 0.2 : 0.205)

    const build = (type: TextureDataType) => {
      const gpu = new GPUComputationRenderer(tier.w, tier.h, this.renderer)
      gpu.setDataType(type)
      const pos0 = gpu.createTexture()
      const vel0 = gpu.createTexture()
      const tgt = gpu.createTexture()
      const pd = pos0.image.data as unknown as Float32Array
      const td = tgt.image.data as unknown as Float32Array
      for (let i = 0; i < count; i++) {
        // start dispersed: a loose shell of ink around where the name will form
        const r = 8 + Math.random() * 9
        const th = Math.random() * Math.PI * 2
        const ph = Math.acos(2 * Math.random() - 1)
        pd[i * 4] = this.o.calm ? cloud.points[i * 3]! * initialFit : Math.sin(ph) * Math.cos(th) * r
        pd[i * 4 + 1] = this.o.calm ? cloud.points[i * 3 + 1]! * initialFit + initialY : Math.sin(ph) * Math.sin(th) * r * 0.7
        pd[i * 4 + 2] = this.o.calm ? cloud.points[i * 3 + 2]! * initialFit : Math.cos(ph) * r * 0.6 - 2
        pd[i * 4 + 3] = 0
        td[i * 4] = cloud.points[i * 3]!
        td[i * 4 + 1] = cloud.points[i * 3 + 1]!
        td[i * 4 + 2] = cloud.points[i * 3 + 2]!
        td[i * 4 + 3] = Math.random()
      }
      const velVar = gpu.addVariable('textureVelocity', velocityShader, vel0)
      const posVar = gpu.addVariable('texturePosition', positionShader, pos0)
      gpu.setVariableDependencies(velVar, [velVar, posVar])
      gpu.setVariableDependencies(posVar, [velVar, posVar])
      Object.assign(velVar.material.uniforms, {
        tTarget: { value: tgt },
        uTime: { value: 0 },
        uDt: { value: 1 / 60 },
        uAssemble: { value: this.o.calm ? 1 : 0 },
        uSpring: { value: 18 },
        uDamp: { value: 7.5 },
        uNoise: { value: this.o.calm ? 0 : 0.12 },
        uRadius: { value: 0.9 },
        uStrength: { value: 28 },
        uMouseOn: { value: 0 },
        uMouse: { value: this.mouse },
        uCenter: { value: this.center },
        uScale: { value: 1 },
      })
      posVar.material.uniforms.uDt = { value: 1 / 60 }
      const err = gpu.init()
      return { gpu, velVar, posVar, err }
    }

    let built = build(FloatType)
    if (built.err !== null) built = build(HalfFloatType)
    if (built.err !== null) {
      this.renderer.dispose()
      canvas.remove()
      return false
    }
    this.gpu = built.gpu
    this.velVar = built.velVar
    this.posVar = built.posVar

    // render geometry: one vertex per particle, looks up its texel
    const geo = new BufferGeometry()
    const ref = new Float32Array(count * 2)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      ref[i * 2] = ((i % tier.w) + 0.5) / tier.w
      ref[i * 2 + 1] = (Math.floor(i / tier.w) + 0.5) / tier.h
      seed[i] = Math.random()
    }
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    geo.setAttribute('aRef', new BufferAttribute(ref, 2))
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1))
    const base = new Color(this.o.color)
    this.pointsMat = new ShaderMaterial({
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        tPos: { value: null },
        uSize: { value: tier.size },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uFade: { value: this.o.calm ? 1 : 0 },
        uSizeScale: { value: 1 },
        uKeep: { value: 1 },
        uColor: { value: base },
        uTint: { value: new Color('#3c5a82') },
      },
    })
    const points = new Points(geo, this.pointsMat)
    points.frustumCulled = false
    this.scene.add(points)

    if (!this.o.calm) this.addDust(quality === 'low' ? 160 : 520)

    this.resize()
    this.running = true
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    return true
  }

  private addDust(n: number) {
    const geo = new BufferGeometry()
    const base = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      base[i * 3] = (Math.random() - 0.5) * 36
      base[i * 3 + 1] = (Math.random() - 0.5) * 22
      base[i * 3 + 2] = -10 + Math.random() * 14
      seed[i] = Math.random()
    }
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('aBase', new BufferAttribute(base, 3))
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1))
    this.dustMat = new ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uBounds: { value: new Vector3(18, 11, 7) },
        uColor: { value: new Color('#566173') },
      },
    })
    const dust = new Points(geo, this.dustMat)
    dust.frustumCulled = false
    this.scene.add(dust)
  }

  resize = () => {
    if (!this.renderer) return
    const c = this.canvas
    const w = c.clientWidth || window.innerWidth
    const h = c.clientHeight || window.innerHeight
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.viewW = VIS_H * this.camera.aspect
    this.ppu = h / VIS_H
    // Name width: ~60% of the viewport on desktop, wider on narrow screens; also capped by height.
    const wantW = this.viewW * (w < 720 ? 0.88 : w < 1100 ? 0.7 : 0.6)
    const maxH = VIS_H * 0.3
    this.fit = Math.min(wantW, maxH / Math.max(this.aspect, 0.05))
    // dots are pixels, the name is not: keep their weight proportional to the name's on-screen size
    this.sizeBase = Math.min(1, Math.max(0.5, (this.fit * this.ppu) / 900))
    this.pointsMat.uniforms.uPixelRatio!.value = this.renderer.getPixelRatio()
    if (this.dustMat) this.dustMat.uniforms.uPixelRatio!.value = this.renderer.getPixelRatio()
  }

  setPointer(clientX: number, clientY: number, active: boolean) {
    this.mouseTarget = active ? 1 : 0
    if (!active) return
    this.pointerNdc.set((clientX / this.width) * 2 - 1, -((clientY / this.height) * 2 - 1))
    this.mouse.set((this.pointerNdc.x * this.viewW) / 2, (this.pointerNdc.y * VIS_H) / 2, 0)
  }

  /** Cursor is snapped on the name: the cloud reacts more strongly. */
  setLocked(locked: boolean) {
    this.boostTarget = locked ? 1 : 0
  }

  /** Screen-space box of the name at the current progress, for cursor snapping and the hit button. */
  getNameBox(): ScreenBox {
    const w = this.fit * this.scale
    const h = w * this.aspect
    const cx = this.width / 2
    const cy = this.height / 2 - this.center.y * this.ppu
    return { x: cx - (w * this.ppu) / 2, y: cy - (h * this.ppu) / 2, w: w * this.ppu, h: h * this.ppu }
  }

  private frame = (now: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.frame)
    const raw = (now - this.last) / 1000
    this.last = now
    const dt = Math.min(raw, 1 / 30)
    this.t += dt

    // frame-time watchdog
    this.frameTimes.push(raw * 1000)
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      this.frameTimes.length = 0
      this.o.onFrameTime?.(avg)
    }

    // intro: dispersed -> assembled
    if (!this.o.calm) {
      this.introT = Math.min(1, this.introT + dt / 3.0)
      if (this.introT >= 0.82 && !this.introFired) {
        this.introFired = true
        this.o.onIntroDone?.()
      }
    } else if (!this.introFired) {
      this.introFired = true
      this.o.onIntroDone?.()
    }
    const assemble = this.o.calm ? 1 : easeOutExpo(this.introT)
    this.pointsMat.uniforms.uFade!.value = this.o.calm ? 1 : smoothstep(0, 0.35, this.introT)

    // layout follows stage progress: the name rises and shrinks as the sheet resolves
    const p = runtime.progress
    const e = p * p * (3 - 2 * p)
    this.scale = lerp(1, SHRINK, e)
    const y0 = VIS_H * (this.height < 560 ? 0.2 : 0.205)
    const y1 = VIS_H * (this.width < 720 ? 0.38 : 0.395)
    this.center.set(0, lerp(y0, y1, e), 0)
    this.pointsMat.uniforms.uSizeScale!.value = this.sizeBase * lerp(1, 0.9, e)
    this.pointsMat.uniforms.uKeep!.value = lerp(1, 0.75, e)

    this.mouseOn += (this.mouseTarget - this.mouseOn) * Math.min(1, dt * 8)
    this.boost += (this.boostTarget - this.boost) * Math.min(1, dt * 6)

    const u = this.velVar.material.uniforms
    u.uTime!.value = this.t
    u.uDt!.value = dt
    u.uAssemble!.value = assemble
    u.uMouseOn!.value = this.mouseOn
    u.uRadius!.value = lerp(0.75, 0.95, this.boost) * (this.o.coarse ? 1.2 : 1)
    u.uStrength!.value = lerp(10, 15, this.boost)
    u.uScale!.value = this.fit * this.scale
    this.posVar.material.uniforms.uDt!.value = dt
    // ambient drift eases off while the sheet is open so the name stays legible above it
    u.uNoise!.value = this.o.calm ? 0 : lerp(0.12, 0.05, e)

    this.gpu.compute()
    this.pointsMat.uniforms.tPos!.value = this.gpu.getCurrentRenderTarget(this.posVar).texture
    if (this.dustMat) this.dustMat.uniforms.uTime!.value = this.t
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.running = false
    cancelAnimationFrame(this.raf)
    this.scene.traverse((o) => {
      const m = o as Points
      m.geometry?.dispose()
    })
    this.pointsMat?.dispose()
    this.dustMat?.dispose()
    this.gpu?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.canvas?.remove()
  }

  get isRunning() {
    return this.running
  }
}
