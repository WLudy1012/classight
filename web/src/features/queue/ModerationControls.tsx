import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { speechApi, type PreviewTicket, type SpeechEntry } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Badge, Button, Field, Input, toast } from '@/shared/ui'

export function EntryReviewControls({ entry, manage, canEdit, refresh }: {
  entry: SpeechEntry
  manage: boolean
  canEdit: boolean
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const [topic, setTopic] = useState<string | null>(null)
  const canReview = manage && (entry.status === 'queued' || entry.status === 'skipped')
  const review = useMutation({
    mutationFn: (status: 'approved' | 'returned') => speechApi.reviewEntry(entry.id, { status, note: note.trim(), version: entry.version }),
    onSuccess: () => { setReturning(false); setNote(''); refresh() },
    onError: (error) => { toast.error(errorMessage(error)); refresh() },
  })
  const edit = useMutation({
    mutationFn: (value: string) => speechApi.updateEntry(entry.id, { topic: value, version: entry.version }),
    onSuccess: () => { setTopic(null); refresh() },
    onError: (error) => { toast.error(errorMessage(error)); refresh() },
  })
  return (
    <div className="meeting-review">
      <div className="row-actions">
        <Badge tone={entry.reviewStatus === 'approved' ? 'success' : entry.reviewStatus === 'returned' ? 'danger' : undefined}>
          {t(`queue.review.${entry.reviewStatus}`)}
        </Badge>
        {canReview && <>
          {entry.reviewStatus !== 'approved' && <Button size="sm" variant="secondary" loading={review.isPending && review.variables === 'approved'} disabled={review.isPending} onClick={() => review.mutate('approved')}>{t('queue.review.approve')}</Button>}
          <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => { setReturning(!returning); setNote(entry.reviewNote ?? '') }}>{t('queue.review.return')}</Button>
        </>}
        {canEdit && topic === null && <Button size="sm" variant="ghost" onClick={() => setTopic(entry.topic)}>{t('queue.review.editTopic')}</Button>}
      </div>
      {entry.reviewNote && <p className="small">{t('queue.review.feedback', { note: entry.reviewNote })}</p>}
      {returning && canReview && <form className="inline-form" onSubmit={(event) => {
        event.preventDefault()
        if (note.trim() && !review.isPending) review.mutate('returned')
      }}>
        <Field label={t('queue.review.reason')}><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required /></Field>
        <Button type="submit" size="sm" disabled={!note.trim()} loading={review.isPending}>{t('queue.review.confirmReturn')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>{t('common.cancel')}</Button>
      </form>}
      {topic !== null && canEdit && <form className="inline-form" onSubmit={(event) => {
        event.preventDefault()
        if (topic.trim() && !edit.isPending) edit.mutate(topic.trim())
      }}>
        <Field label={t('queue.topic')}><Input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} required /></Field>
        <Button type="submit" size="sm" loading={edit.isPending} disabled={!topic.trim()}>{t('common.save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setTopic(null)}>{t('common.cancel')}</Button>
      </form>}
    </div>
  )
}

export function DisplayControls({ entry, refresh }: { entry: SpeechEntry; refresh: () => void }) {
  const { t } = useTranslation()
  const [ticket, setTicket] = useState<PreviewTicket | null>(null)
  const start = useMutation({
    mutationFn: () => speechApi.startDisplay(entry.courseware!.id),
    onSuccess: (result) => { setTicket(result); refresh() },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const stop = useMutation({
    mutationFn: () => speechApi.stopDisplay(entry.id),
    onSuccess: () => { setTicket(null); refresh() },
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (entry.status !== 'speaking' || entry.reviewStatus !== 'approved' || !entry.courseware || entry.courseware.previewMode === 'none') return null
  const url = ticket && new URL(`/meetings/display#${new URLSearchParams({ mode: ticket.mode, url: ticket.url })}`, window.location.origin).toString()
  return (
    <div className="meeting-review">
      <div className="row-actions">
        <Button size="sm" variant="secondary" loading={start.isPending} disabled={stop.isPending} onClick={() => start.mutate()}>{t(entry.displaying ? 'queue.display.refresh' : 'queue.display.start')}</Button>
        {entry.displaying && <Button size="sm" variant="ghost" loading={stop.isPending} disabled={start.isPending} onClick={() => stop.mutate()}>{t('queue.display.stop')}</Button>}
      </div>
      {entry.displaying && url && <Field label={t('queue.display.link')} hint={t('queue.display.until', { time: new Date(ticket.expiresAt).toLocaleTimeString() })}>
        <div className="inline-form">
          <Input readOnly value={url} onFocus={(event) => event.target.select()} />
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">{t('queue.display.open')}</a>
        </div>
      </Field>}
    </div>
  )
}
