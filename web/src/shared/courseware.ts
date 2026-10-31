import { unzipSync } from 'fflate'
import type { CoursewareKind } from '@/shared/api'

/**
 * Client-side courseware rules. They mirror what the server enforces (contract §S1) so people hear
 * "this is not a slide deck" before waiting on an upload; the server stays the authority.
 */

export const COURSEWARE_ACCEPT = '.pptx,.ppt,.pdf,.zip'

export type CoursewareProblem = 'unsupported' | 'tooLarge' | 'noIndex' | 'badArchive' | 'empty'

export type CoursewareCheck = { ok: true; kind: CoursewareKind } | { ok: false; problem: CoursewareProblem }

export function kindFromName(name: string): CoursewareKind | null {
  const ext = name.toLowerCase().split('.').pop()
  switch (ext) {
    case 'pptx':
      return 'pptx'
    case 'ppt':
      return 'ppt'
    case 'pdf':
      return 'pdf'
    case 'zip':
      return 'web'
    default:
      return null
  }
}

/** Entry names of a zip without inflating any of them. */
export function zipEntryNames(data: Uint8Array): string[] {
  const names: string[] = []
  unzipSync(data, {
    filter: (f) => {
      names.push(f.name)
      return false
    },
  })
  return names
}

/** `index.html` at the root, or inside the only top-level folder (the way "compress folder" zips). */
export function findWebIndex(names: string[]): string | null {
  const files = names.filter((n) => !n.endsWith('/') && !n.startsWith('__MACOSX/'))
  if (files.includes('index.html')) return 'index.html'
  const tops = new Set(files.map((n) => n.split('/')[0]))
  if (tops.size === 1) {
    const top = [...tops][0]!
    const cand = `${top}/index.html`
    if (files.includes(cand)) return cand
  }
  return null
}

export async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
}

export async function precheckCourseware(file: File, maxMb: number): Promise<CoursewareCheck> {
  const kind = kindFromName(file.name)
  if (!kind) return { ok: false, problem: 'unsupported' }
  if (file.size === 0) return { ok: false, problem: 'empty' }
  if (file.size > maxMb * 1024 * 1024) return { ok: false, problem: 'tooLarge' }
  if (kind === 'web') {
    try {
      const names = zipEntryNames(await readBytes(file))
      if (!findWebIndex(names)) return { ok: false, problem: 'noIndex' }
    } catch {
      return { ok: false, problem: 'badArchive' }
    }
  }
  return { ok: true, kind }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
