import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type DataTexture,
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
import { dustFragment, dustVertex, pointsFragment, pointsVertex, positionShader, shadowFragment, shadowVertex, velocityShader } from './shaders'
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
const STEP = 1 / 60

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
  private shadowMat?: ShaderMaterial
  private dustMat?: ShaderMaterial
  private targetTexture?: DataTexture
  private raf = 0
  private last = 0
  private t = 0
  private accumulator = 0
  private introT = 0
  private introFired = false
  private disposed = false
  private frameTimes: number[] = []
  private width = 1
  private height = 1
  private aspect = 0.2
  private fit = 8
  private mouse = new Vector3(999, 999, 0)
  private mousePrevious = new Vector3(999, 999, 0)
  private mouseVelocity = new Vector3()
  private mouseDelta = new Vector3()
  private light = new Vector3(-4, 7, 5)
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
      if (this.disposed) return false
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
        uSpring: { value: 24 },
        uDamp: { value: this.o.calm ? 9 : 5.8 },
        uNoise: { value: 0 },
        uRadius: { value: 0.9 },
        uStrength: { value: 28 },
        uMouseOn: { value: 0 },
        uMouse: { value: this.mouse },
        uMousePrev: { value: this.mousePrevious },
        uMouseVelocity: { value: this.mouseVelocity },
        uCenter: { value: this.center },
        uScale: { value: 1 },
      })
      posVar.material.uniforms.uDt = { value: 1 / 60 }
      const err = gpu.init()
      return { gpu, velVar, posVar, tgt, err }
    }

    let built = build(FloatType)
    if (built.err !== null) {
      built.gpu.dispose()
      built.tgt.dispose()
      built = build(HalfFloatType)
    }
    if (built.err !== null) {
      built.gpu.dispose()
      built.tgt.dispose()
      this.renderer.dispose()
      canvas.remove()
      return false
    }
    this.gpu = built.gpu
    this.velVar = built.velVar
    this.posVar = built.posVar
    this.targetTexture = built.tgt

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
    geo.setAttribute('aNormal', new BufferAttribute(cloud.normals, 3))
    const base = new Color(this.o.color)
    this.pointsMat = new ShaderMaterial({
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        tPos: { value: this.gpu.getCurrentRenderTarget(this.posVar).texture },
        tPrevious: { value: this.gpu.getAlternateRenderTarget(this.posVar).texture },
        uBlend: { value: 1 },
        uSize: { value: tier.size },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uFade: { value: this.o.calm ? 1 : 0 },
        uSizeScale: { value: 1 },
        uKeep: { value: 1 },
        uColor: { value: base },
        uTint: { value: base.clone().lerp(new Color('#6b7686'), 0.7) },
        uLight: { value: this.light },
      },
    })
    const points = new Points(geo, this.pointsMat)
    points.frustumCulled = false
    points.renderOrder = 1
    this.scene.add(points)

    if (quality !== 'low') {
      this.shadowMat = new ShaderMaterial({
        vertexShader: shadowVertex,
        fragmentShader: shadowFragment,
        transparent: true,
        depthWrite: false,
        uniforms: this.pointsMat.uniforms,
      })
      const shadow = new Points(geo, this.shadowMat)
      shadow.frustumCulled = false
      this.scene.add(shadow)
    }

    if (!this.o.calm) this.addDust(quality === 'low' ? 160 : 520)

    this.resize()
    this.running = true
    document.addEventListener('visibilitychange', this.onVisibility)
    this.last = performance.now()
    if (!document.hidden) this.raf = requestAnimationFrame(this.frame)
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
        uLight: { value: this.light },
        uColor: { value: new Color('#566173') },
      },
    })
    const dust = new Points(geo, this.dustMat)
    dust.frustumCulled = false
    this.scene.add(dust)
  }

  resize = () => {
    if (!this.pointsMat || this.disposed) return
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
    const wasActive = this.mouseTarget > 0
    this.mouseTarget = active ? 1 : 0
    if (!active) return
    const rect = this.canvas.getBoundingClientRect()
    this.pointerNdc.set(((clientX - rect.left) / this.width) * 2 - 1, -(((clientY - rect.top) / this.height) * 2 - 1))
    this.mouse.set((this.pointerNdc.x * this.viewW) / 2, (this.pointerNdc.y * VIS_H) / 2, 0)
    if (!wasActive) {
      this.mousePrevious.copy(this.mouse)
      this.mouseVelocity.set(0, 0, 0)
    }
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

  private onVisibility = () => {
    cancelAnimationFrame(this.raf)
    this.setPointer(0, 0, false)
    this.mouseOn = 0
    this.mouseVelocity.set(0, 0, 0)
    this.mousePrevious.copy(this.mouse)
    this.accumulator = 0
    this.frameTimes.length = 0
    if (!document.hidden && !this.disposed) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  private frame = (now: number) => {
    if (this.disposed || document.hidden) return
    this.raf = requestAnimationFrame(this.frame)
    const raw = (now - this.last) / 1000
    this.last = now
    const dt = Math.max(0, Math.min(raw, STEP * 3))
    this.accumulator += dt

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

    this.mouseOn += (this.mouseTarget - this.mouseOn) * (1 - Math.exp(-dt * 8))
    this.boost += (this.boostTarget - this.boost) * (1 - Math.exp(-dt * 6))

    const u = this.velVar.material.uniforms
    u.uDt!.value = STEP
    u.uAssemble!.value = assemble
    u.uSpring!.value = lerp(24, 50, e)
    u.uDamp!.value = lerp(this.o.calm ? 9 : 5.8, 13, e)
    u.uMouseOn!.value = this.mouseOn
    u.uRadius!.value = lerp(0.7, 1.05, this.boost) * (this.o.coarse ? 1.2 : 1) * lerp(1, 0.6, e)
    u.uStrength!.value = lerp(18, 26, this.boost) * (this.o.calm ? 0.4 : 1)
    u.uScale!.value = this.fit * this.scale
    this.posVar.material.uniforms.uDt!.value = STEP
    u.uNoise!.value = this.o.calm ? 0 : Math.min(0.095, this.fit * 0.012) * lerp(1, 0.18, e)

    if (this.accumulator >= STEP) {
      this.mouseDelta.copy(this.mouse).sub(this.mousePrevious).divideScalar(this.accumulator).clampLength(0, 18)
      this.mouseVelocity.lerp(this.mouseDelta, 1 - Math.exp(-this.accumulator * 14))
      while (this.accumulator >= STEP) {
        this.t += STEP
        u.uTime!.value = this.t
        this.gpu.compute()
        this.accumulator -= STEP
        this.mousePrevious.copy(this.mouse)
      }
    }

    this.pointsMat.uniforms.tPos!.value = this.gpu.getCurrentRenderTarget(this.posVar).texture
    this.pointsMat.uniforms.tPrevious!.value = this.gpu.getAlternateRenderTarget(this.posVar).texture
    this.pointsMat.uniforms.uBlend!.value = this.accumulator / STEP
    const lightTime = this.o.calm ? 0 : this.t * 0.24
    this.light.set(
      Math.sin(lightTime) * this.fit * 0.65 - this.fit * 0.3,
      this.center.y + 3.5 + Math.cos(lightTime * 0.7) * 0.6,
      4.5 + Math.sin(lightTime * 0.8) * 0.8,
    )
    if (this.dustMat) this.dustMat.uniforms.uTime!.value = this.t
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.disposed = true
    this.running = false
    cancelAnimationFrame(this.raf)
    document.removeEventListener('visibilitychange', this.onVisibility)
    const geometries = new Set<BufferGeometry>()
    this.scene.traverse((o) => {
      const m = o as Points
      if (m.geometry) geometries.add(m.geometry)
    })
    geometries.forEach((geometry) => geometry.dispose())
    this.pointsMat?.dispose()
    this.shadowMat?.dispose()
    this.dustMat?.dispose()
    this.targetTexture?.dispose()
    this.gpu?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.canvas?.remove()
  }

  get isRunning() {
    return this.running
  }
}
