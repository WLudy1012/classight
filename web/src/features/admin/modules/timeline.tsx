import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type TimelineEvent } from '@/shared/api'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { Badge, Button, ConfirmDialog, Dialog, Field, Input, Pagination, StateView, Textarea, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

function EventForm({ event, onClose }: { event: TimelineEvent | null; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [d, setD] = useState({
    title: event?.title ?? '',
    summary: event?.summary ?? '',
    body: event?.body ?? '',
    occurredOn: event?.occurredOn.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    tags: event?.tags.join(', ') ?? '',
  })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () => {
      const body = { ...d, tags: d.tags.split(',').map((x) => x.trim()).filter(Boolean) }
      return event ? adminApi.updateTimeline(event.id, body) : adminApi.createTimeline(body)
    },
    onSuccess: () => {
      toast.success(t('common.saved'))
      void qc.invalidateQueries({ queryKey: ['admin', 'timeline'] })
      void qc.invalidateQueries({ queryKey: ['class'] })
      onClose()
    },
    onError: (e) => {
      setError(errorMessage(e))
      setFields(fieldErrors(e))
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setFields({})
    m.mutate()
  }
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((s) => ({ ...s, [k]: e.target.value }))
  return (
    <Dialog
      open
      onClose={onClose}
      title={event ? t('admin.timeline.edit') : t('admin.timeline.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="event-form" loading={m.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="event-form" className="form-stack" onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Field label={t('admin.timeline.eventTitle')} error={fields.title}>
          <Input autoFocus value={d.title} onChange={set('title')} invalid={!!fields.title} />
        </Field>
        <Field label={t('admin.timeline.date')} error={fields.occurredOn}>
          <Input type="date" value={d.occurredOn} onChange={set('occurredOn')} invalid={!!fields.occurredOn} />
        </Field>
        <Field label={t('admin.timeline.summary')}>
          <Input value={d.summary} onChange={set('summary')} />
        </Field>
        <Field label={t('admin.timeline.body')}>
          <Textarea value={d.body} onChange={set('body')} />
        </Field>
        <Field label={t('admin.timeline.tags')}>
          <Input value={d.tags} onChange={set('tags')} />
        </Field>
      </form>
    </Dialog>
  )
}

function TimelineAdmin() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<TimelineEvent | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<TimelineEvent | null>(null)
  const q = useQuery({
    queryKey: ['admin', 'timeline', i18n.language, page],
    queryFn: () => adminApi.timeline({ page, pageSize: 12 }),
    placeholderData: keepPreviousData,
  })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteTimeline(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'timeline'] })
      void qc.invalidateQueries({ queryKey: ['class'] })
      setDeleting(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="page">
      <PageHeader
        title={t('admin.timeline.title')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
            {t('admin.timeline.add')}
          </Button>
        }
      />
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && q.data.items.length === 0 ? (
          <StateView icon="timeline" title={t('common.noResults')} />
        ) : (
          q.data && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('admin.timeline.date')}</th>
                      <th>{t('admin.timeline.eventTitle')}</th>
                      <th>{t('admin.timeline.tags')}</th>
                      <th className="col-actions">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((ev) => (
                      <tr key={ev.id}>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(ev.occurredOn)}
                        </td>
                        <td>
                          <strong>{ev.title}</strong>
                          <div className="muted small">{ev.summary}</div>
                        </td>
                        <td>
                          <span className="row-gap">
                            {ev.tags.map((tag) => (
                              <Badge key={tag}>{tag}</Badge>
                            ))}
                          </span>
                        </td>
                        <td className="col-actions">
                          <span className="row-actions">
                            <Button size="sm" variant="ghost" iconOnly icon="edit" aria-label={t('common.edit')} onClick={() => setEditing(ev)} />
                            <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={t('common.delete')} onClick={() => setDeleting(ev)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={12} total={q.data.total} onPage={setPage} />
            </>
          )
        )}
      </QueryBoundary>
      {editing !== undefined && <EventForm event={editing} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('admin.timeline.deleteTitle')}
        body={deleting && t('admin.timeline.deleteBody', { name: deleting.title })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

registerAdminModule({
  id: 'timeline',
  group: 'class',
  order: 12,
  label: 'admin.nav.timeline',
  icon: 'timeline',
  path: 'timeline',
  permission: 'class.timeline.manage',
  element: TimelineAdmin,
})
