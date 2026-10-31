import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { unzipSync } from 'fflate'
import { useTranslation } from 'react-i18next'
import { speechApi, type Capabilities, type Courseware, type SpeechEntry } from '@/shared/api'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Badge, Button, ConfirmDialog, Dropzone, Icon, Progress, toast } from '@/shared/ui'
import { downloadCourseware } from './download'

const CoursewarePreview = lazy(() => import('./CoursewarePreview').then((m) => ({ default: m.CoursewarePreview })))

const ACCEPT = '.ppt,.pptx,.pdf,.zip'

/** Cheap checks before a large upload; the server still re-validates everything by content. */
export async function precheck(file: File, caps: Capabilities | undefined, t: (k: string, o?: Record<string, unknown>) => string): Promise<string | null> {
  const name = file.name.toLowerCase()
  const ext = name.slice(name.lastIndexOf('.') + 1)
  if (!['ppt', 'pptx', 'pdf', 'zip'].includes(ext)) return t('queue.precheck.type')
  const mb = caps?.maxCoursewareMb ?? 50
  if (file.size > mb * 1024 * 1024) return t('queue.precheck.size', { mb })
  if (ext === 'zip') {
    try {
      // Only the directory is needed to find index.html, but fflate reads whole archives: skip the check for big ones.
      if (file.size <= 40 * 1024 * 1024) {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => /(^|\/)index\.html?$/i.test(f.name) })
        if (!Object.keys(entries).length) return t('queue.precheck.noIndex')
      }
    } catch {
      return t('queue.precheck.badZip')
    }
  }
  return null
}

export const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Upload / replace / preview / download / delete for one entry's courseware. */
export function CoursewarePanel({ entry, canEdit, caps, invalidate }: { entry: SpeechEntry; canEdit: boolean; caps?: Capabilities; invalidate: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const cw = entry.courseware
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null)
  const [error, setError] = useState('')
  const [previewing, setPreviewing] = useState<Courseware | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      abort.current = new AbortController()
      setProgress({ name: file.name, value: 0 })
      return speechApi.uploadCourseware(entry.id, file, (loaded, total) => setProgress({ name: file.name, value: total ? loaded / total : 0 }), abort.current.signal)
    },
    onSuccess: () => {
      toast.success(t('queue.coursewareUploaded'))
      invalidate()
    },
    onError: (e) => {
      if ((e as { name?: string }).name === 'AbortError') return
      setError(errorMessage(e))
    },
    onSettled: () => setProgress(null),
  })
  const remove = useMutation({
    mutationFn: () => speechApi.deleteCourseware(cw!.id),
    onSuccess: () => {
      toast.success(t('queue.coursewareDeleted'))
      setConfirmDelete(false)
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const pick = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setError('')
    const problem = await precheck(file, caps, t as never)
    if (problem) return setError(problem)
    upload.mutate(file)
  }

  // while the server converts a presentation to PDF, keep asking so the badge flips to "ready"
  const converting = cw?.conversion === 'converting'
  useEffect(() => {
    if (!converting) return
    const id = window.setInterval(() => void qc.invalidateQueries({ queryKey: ['speech', 'session', entry.sessionId] }), 3000)
    return () => window.clearInterval(id)
  }, [converting, qc, entry.sessionId])

  return (
    <div className="cw">
      {cw && (
        <div className="cw__file">
          <Icon name={cw.kind === 'web' ? 'web' : cw.kind === 'pdf' ? 'file' : 'presentation'} size={20} />
          <div className="cw__meta">
            <span className="cw__name">{cw.originalName}</span>
            <span className="cw__sub">
              <Badge>{t(`queue.kind.${cw.kind}`)}</Badge>
              <span className="num">{formatSize(cw.size)}</span>
              {cw.conversion === 'converting' && <span>{t('queue.converting')}</span>}
              {cw.conversion === 'failed' && <span className="cw__warn">{t('queue.convertFailed')}</span>}
            </span>
            <span className="cw__sub muted">{t('queue.uploadedBy', { name: cw.uploader.displayName, time: formatDate(cw.uploadedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
          </div>
          <div className="row-actions">
            <Button size="sm" variant="secondary" icon="play" onClick={() => setPreviewing(cw)}>
              {t('queue.preview')}
            </Button>
            <Button size="sm" variant="ghost" iconOnly icon="download" aria-label={t('queue.download')} onClick={() => void downloadCourseware(cw)} />
            {canEdit && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={t('queue.coursewareDelete')} onClick={() => setConfirmDelete(true)} />}
          </div>
        </div>
      )}

      {progress && (
        <div className="cw__progress">
          <Progress value={progress.value} label={t('queue.uploading', { name: progress.name })} trailing={<button className="cw__cancel" onClick={() => abort.current?.abort()}>{t('common.cancel')}</button>} />
          <span className="cw__sub muted">{t('queue.uploading', { name: progress.name })}</span>
        </div>
      )}

      {canEdit && !progress && (
        <Dropzone
          compact={!!cw}
          accept={ACCEPT}
          onFiles={(f) => void pick(f)}
          title={cw ? t('queue.coursewareReplace') : t('queue.coursewareDrop')}
          hint={t('queue.coursewareHint', { mb: caps?.maxCoursewareMb ?? 50 })}
          error={error}
        />
      )}
      {!canEdit && !cw && <p className="muted small">{t('queue.coursewareNone')}</p>}

      {previewing && (
        <Suspense fallback={null}>
          <CoursewarePreview courseware={previewing} onClose={() => setPreviewing(null)} />
        </Suspense>
      )}
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('queue.coursewareDeleteTitle')}
        body={cw && t('queue.coursewareDeleteBody', { name: cw.originalName })}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}
