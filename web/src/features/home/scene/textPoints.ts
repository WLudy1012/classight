/**
 * Turns a string into a volumetric point cloud. The text is rasterized once on a 2D canvas
 * (so any language and any loaded font works), then points are sampled from the ink and given
 * depth, which is what makes the name read as a solid body rather than a flat sticker.
 */
export interface TextCloud {
  /** xyz per point, normalized so the ink's width is 1 and it is centered on the origin */
  points: Float32Array
  /** ink height / ink width */
  aspect: number
}

const FONT_STACK = '"Geist Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'

export async function ensureFonts(text: string) {
  try {
    await Promise.all([
      document.fonts.load(`600 200px "Geist Variable"`, text),
      document.fonts.load(`600 200px "Noto Sans SC"`, text),
    ])
  } catch {
    /* fall back to whatever is installed */
  }
}

export function sampleText(text: string, count: number): TextCloud {
  const size = 240
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `600 ${size}px ${FONT_STACK}`
  const width = Math.max(1, Math.ceil(probe.measureText(text).width))
  const pad = 24
  const canvas = document.createElement('canvas')
  canvas.width = width + pad * 2
  canvas.height = Math.ceil(size * 1.5) + pad * 2
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.font = `600 ${size}px ${FONT_STACK}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(text, pad, canvas.height / 2)

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const W = canvas.width
  const H = canvas.height
  const fill: number[] = []
  const edge: number[] = []
  let minX = W
  let maxX = 0
  let minY = H
  let maxY = 0
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && data[(y * W + x) * 4 + 3]! > 128
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!on(x, y)) continue
      const i = y * W + x
      fill.push(i)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (!on(x - 2, y) || !on(x + 2, y) || !on(x, y - 2) || !on(x, y + 2)) edge.push(i)
    }
  }

  const inkW = Math.max(1, maxX - minX)
  const inkH = Math.max(1, maxY - minY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const out = new Float32Array(count * 3)
  // Depth scales with letter height so a long name does not become a thin slab.
  const depth = Math.min(0.05, (inkH / inkW) * 0.3 + 0.012)

  for (let n = 0; n < count; n++) {
    const useEdge = edge.length > 0 && Math.random() < 0.16
    const src = useEdge ? edge : fill
    const i = src[(Math.random() * src.length) | 0] ?? 0
    const px = (i % W) + Math.random() - 0.5
    const py = Math.floor(i / W) + Math.random() - 0.5
    out[n * 3] = (px - cx) / inkW
    out[n * 3 + 1] = -(py - cy) / inkW
    const zr = (Math.random() + Math.random() - 1)
    out[n * 3 + 2] = zr * depth * 0.5
  }
  return { points: out, aspect: inkH / inkW }
}
