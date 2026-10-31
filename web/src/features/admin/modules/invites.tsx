import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type Invite } from '@/shared/api'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { Badge, Button, ConfirmDialog, Dialog, Field, Input, Pagination, Select, StateView, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

function CreateInvite({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const [d, setD] = useState({ code: '', role: 'Member', maxUses: '1', expiresAt: '' })
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () =>
      adminApi.createInvite({
        code: d.code.trim() || undefined,
        role: d.role,
        maxUses: Number(d.maxUses) || 1,
        expiresAt: d.expiresAt ? new Date(d.expiresAt + 'T23:59:59').toISOString() : undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] })
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
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.invites.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="invite-form" loading={m.isPending}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="invite-form" className="form-stack" onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Field label={t('admin.invites.code')} hint={t('admin.invites.codeHint')} error={fields.code}>
          <Input autoFocus value={d.code} onChange={(e) => setD((s) => ({ ...s, code: e.target.value }))} invalid={!!fields.code} />
        </Field>
        <div className="grid-2">
          <Field label={t('admin.invites.role')}>
            <Select value={d.role} onChange={(e) => setD((s) => ({ ...s, role: e.target.value }))}>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('admin.invites.maxUses')}>
            <Input type="number" min={1} value={d.maxUses} onChange={(e) => setD((s) => ({ ...s, maxUses: e.target.value }))} />
          </Field>
        </div>
        <Field label={t('admin.invites.expires')} hint={t('admin.invites.never')}>
          <Input type="date" value={d.expiresAt} onChange={(e) => setD((s) => ({ ...s, expiresAt: e.target.value }))} />
        </Field>
      </form>
    </Dialog>
  )
}

function InvitesAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Invite | null>(null)
  const q = useQuery({ queryKey: ['admin', 'invites', page], queryFn: () => adminApi.invites({ page, pageSize: 15 }), placeholderData: keepPreviousData })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteInvite(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'invites'] })
      setDeleting(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const expired = (i: Invite) => !!i.expiresAt && new Date(i.expiresAt) < new Date()

  return (
    <div className="page">
      <PageHeader
        title={t('admin.invites.title')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('admin.invites.add')}
          </Button>
        }
      />
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && q.data.items.length === 0 ? (
          <StateView icon="ticket" title={t('common.noResults')} />
        ) : (
          q.data && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('admin.invites.code')}</th>
                      <th>{t('admin.invites.role')}</th>
                      <th>{t('admin.invites.used')}</th>
                      <th>{t('admin.invites.expires')}</th>
                      <th className="col-actions">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((i) => (
                      <tr key={i.id}>
                        <td className="mono" style={{ fontSize: 'var(--text-sm)' }}>
                          {i.code}
                        </td>
                        <td>{i.role}</td>
                        <td className="num">
                          {i.usedCount} / {i.maxUses}
                        </td>
                        <td className="num">
                          {i.expiresAt ? formatDate(i.expiresAt) : t('admin.invites.never')} {expired(i) && <Badge tone="danger">{t('admin.invites.expired')}</Badge>}
                        </td>
                        <td className="col-actions">
                          <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={t('common.delete')} onClick={() => setDeleting(i)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={15} total={q.data.total} onPage={setPage} />
            </>
          )
        )}
      </QueryBoundary>
      {creating && <CreateInvite onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('admin.invites.deleteTitle')}
        body={deleting && t('admin.invites.deleteBody', { name: deleting.code })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

registerAdminModule({
  id: 'invites',
  group: 'people',
  order: 22,
  label: 'admin.nav.invites',
  icon: 'ticket',
  path: 'invites',
  permission: 'invites.manage',
  element: InvitesAdmin,
})
