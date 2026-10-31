import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type AdminMember } from '@/shared/api'
import { useDebounced } from '@/shared/hooks'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { Avatar, Badge, Button, ConfirmDialog, Dialog, Field, Input, Pagination, Select, StateView, Textarea, toast } from '@/shared/ui'
import { dash, PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

interface Draft {
  displayName: string
  title: string
  joinedOn: string
  intro: string
}
const EMPTY: Draft = { displayName: '', title: '', joinedOn: '', intro: '' }

function MemberForm({ member, onClose }: { member: AdminMember | null; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(
    member
      ? { displayName: member.displayName, title: member.title ?? '', joinedOn: member.joinedOn?.slice(0, 10) ?? '', intro: member.intro ?? '' }
      : EMPTY,
  )
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () =>
      member
        ? adminApi.updateMember(member.id, { ...d, joinedOn: d.joinedOn || undefined, version: member.version })
        : adminApi.createMember({ ...d, joinedOn: d.joinedOn || undefined }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      void qc.invalidateQueries({ queryKey: ['admin', 'members'] })
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
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD((s) => ({ ...s, [k]: e.target.value }))
  return (
    <Dialog
      open
      onClose={onClose}
      title={member ? t('admin.members.edit') : t('admin.members.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="member-form" loading={m.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="member-form" className="form-stack" onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Field label={t('admin.members.name')} error={fields.displayName}>
          <Input autoFocus value={d.displayName} onChange={set('displayName')} invalid={!!fields.displayName} />
        </Field>
        <div className="grid-2">
          <Field label={t('admin.members.role')}>
            <Input value={d.title} onChange={set('title')} />
          </Field>
          <Field label={t('admin.members.joinedOn')}>
            <Input type="date" value={d.joinedOn} onChange={set('joinedOn')} />
          </Field>
        </div>
        <Field label={t('admin.members.intro')}>
          <Textarea value={d.intro} onChange={set('intro')} />
        </Field>
      </form>
    </Dialog>
  )
}

function LinkDialog({ member, onClose }: { member: AdminMember; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['admin', 'users', 'all'], queryFn: () => adminApi.users({ pageSize: 100 }) })
  const [userId, setUserId] = useState('')
  const link = useMutation({
    mutationFn: () => adminApi.linkMember(member.id, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'members'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t('admin.members.link')}: ${member.displayName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!userId} loading={link.isPending} onClick={() => link.mutate()}>
            {t('admin.members.link')}
          </Button>
        </>
      }
    >
      <Field label={t('admin.members.linkTo')}>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">—</option>
          {users.data?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} (@{u.username})
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  )
}

function MembersAdmin() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const dq = useDebounced(search, 250)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<AdminMember | null | undefined>(undefined) // undefined = closed, null = new
  const [linking, setLinking] = useState<AdminMember | null>(null)
  const [deleting, setDeleting] = useState<AdminMember | null>(null)

  const q = useQuery({
    queryKey: ['admin', 'members', i18n.language, dq, page],
    queryFn: () => adminApi.members({ q: dq, page, pageSize: 15 }),
    placeholderData: keepPreviousData,
  })
  const unlink = useMutation({
    mutationFn: (id: string) => adminApi.unlinkMember(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'members'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteMember(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'members'] })
      void qc.invalidateQueries({ queryKey: ['class'] })
      setDeleting(null)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="page">
      <PageHeader
        title={t('admin.members.title')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing(null)}>
            {t('admin.members.add')}
          </Button>
        }
      />
      <div className="toolbar">
        <Input
          className="grow"
          type="search"
          placeholder={t('admin.members.search')}
          aria-label={t('common.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
      </div>
      <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && q.data.items.length === 0 ? (
          <StateView icon="users" title={t('common.noResults')} />
        ) : (
          q.data && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('admin.members.name')}</th>
                      <th>{t('admin.members.role')}</th>
                      <th>{t('admin.members.joinedOn')}</th>
                      <th>{t('admin.members.linked')}</th>
                      <th className="col-actions">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <span className="rowline" style={{ gap: 10 }}>
                            <Avatar name={m.displayName} src={m.avatarUrl} size={28} />
                            {m.displayName}
                          </span>
                        </td>
                        <td>{dash(m.title)}</td>
                        <td className="num">{m.joinedOn ? formatDate(m.joinedOn) : '—'}</td>
                        <td>{m.linkedUserId ? <Badge tone="success">{t('admin.members.linked')}</Badge> : <Badge>{t('admin.members.unlinked')}</Badge>}</td>
                        <td className="col-actions">
                          <span className="row-actions">
                            {m.linkedUserId ? (
                              <Button size="sm" variant="ghost" onClick={() => unlink.mutate(m.id)}>
                                {t('admin.members.unlink')}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setLinking(m)}>
                                {t('admin.members.link')}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" iconOnly icon="edit" aria-label={t('common.edit')} onClick={() => setEditing(m)} />
                            <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={t('common.delete')} onClick={() => setDeleting(m)} />
                          </span>
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

      {editing !== undefined && <MemberForm member={editing} onClose={() => setEditing(undefined)} />}
      {linking && <LinkDialog member={linking} onClose={() => setLinking(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('admin.members.deleteTitle')}
        body={deleting && t('admin.members.deleteBody', { name: deleting.displayName })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

registerAdminModule({
  id: 'members',
  group: 'class',
  order: 11,
  label: 'admin.nav.members',
  icon: 'users',
  path: 'members',
  permission: 'class.members.manage',
  element: MembersAdmin,
})
