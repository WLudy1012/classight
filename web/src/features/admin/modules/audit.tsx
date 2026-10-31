import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type AuditLog } from '@/shared/api'
import { useDebounced } from '@/shared/hooks'
import { formatDate } from '@/shared/i18n'
import { Button, Dialog, Input, Pagination, StateView } from '@/shared/ui'
import { dash, PageHeader, QueryBoundary, useActionLabel } from '../common'
import { registerAdminModule } from '../registry'

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation()
  const q = useQuery({ queryKey: ['admin', 'audit', id], queryFn: () => adminApi.auditLog(id) })
  const log = q.data
  return (
    <Dialog open onClose={onClose} title={t('admin.audit.detail')}>
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={3}>
        {log && (
          <div className="stack-sm">
            <dl style={{ margin: 0 }}>
              <div className="statusrow">
                <dt>{t('admin.audit.time')}</dt>
                <dd className="num">{formatDate(log.at, { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
              </div>
              <div className="statusrow">
                <dt>{t('admin.audit.actor')}</dt>
                <dd>{log.actor}</dd>
              </div>
              <div className="statusrow">
                <dt>{t('admin.audit.action')}</dt>
                <dd className="mono">{log.action}</dd>
              </div>
              <div className="statusrow">
                <dt>{t('admin.audit.resource')}</dt>
                <dd>
                  {log.resourceType} <span className="mono muted">{dash(log.resourceId)}</span>
                </dd>
              </div>
            </dl>
            {log.changes?.length ? (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table changes">
                  <thead>
                    <tr>
                      <th>{t('admin.audit.field')}</th>
                      <th>{t('admin.audit.before')}</th>
                      <th>{t('admin.audit.after')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.changes.map((c) => (
                      <tr key={c.field}>
                        <td>{c.field}</td>
                        <td>
                          <code>{show(c.before)}</code>
                        </td>
                        <td>
                          <code>{show(c.after)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small" style={{ marginTop: 12 }}>
                {t('admin.audit.noChanges')}
              </p>
            )}
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

function AuditAdmin() {
  const { t } = useTranslation()
  const actionLabel = useActionLabel()
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<AuditLog | null>(null)
  const dActor = useDebounced(actor, 250)
  const dAction = useDebounced(action, 250)
  const q = useQuery({
    queryKey: ['admin', 'audit', dActor, dAction, from, to, page],
    queryFn: () => adminApi.auditLogs({ actor: dActor, action: dAction, from, to, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  })
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  return (
    <div className="page">
      <PageHeader title={t('admin.audit.title')} />
      <div className="toolbar">
        <Input aria-label={t('admin.audit.filterActor')} placeholder={t('admin.audit.filterActor')} value={actor} onChange={(e) => reset(setActor)(e.target.value)} />
        <Input aria-label={t('admin.audit.filterAction')} placeholder={t('admin.audit.filterAction')} value={action} onChange={(e) => reset(setAction)(e.target.value)} />
        <Input type="date" aria-label={t('admin.audit.from')} title={t('admin.audit.from')} value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        <Input type="date" aria-label={t('admin.audit.to')} title={t('admin.audit.to')} value={to} onChange={(e) => reset(setTo)(e.target.value)} />
      </div>
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && q.data.items.length === 0 ? (
          <StateView icon="activity" title={t('common.noResults')} />
        ) : (
          q.data && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('admin.audit.time')}</th>
                      <th>{t('admin.audit.actor')}</th>
                      <th>{t('admin.audit.action')}</th>
                      <th>{t('admin.audit.summary')}</th>
                      <th className="col-actions">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((a) => (
                      <tr key={a.id}>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(a.at, { dateStyle: 'short', timeStyle: 'medium' })}
                        </td>
                        <td>{a.actor}</td>
                        <td className="mono">{a.action}</td>
                        <td>{actionLabel(a.action)}</td>
                        <td className="col-actions">
                          <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>
                            {t('admin.audit.detail')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={20} total={q.data.total} onPage={setPage} />
            </>
          )
        )}
      </QueryBoundary>
      {open && <Detail id={open.id} onClose={() => setOpen(null)} />}
    </div>
  )
}

registerAdminModule({
  id: 'audit',
  group: 'site',
  order: 31,
  label: 'admin.nav.audit',
  icon: 'activity',
  path: 'audit',
  permission: 'audit.read',
  element: AuditAdmin,
})
