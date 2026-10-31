import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type AdminUser } from '@/shared/api'
import { useAuth } from '@/features/auth/store'
import { useDebounced } from '@/shared/hooks'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { Avatar, Badge, Button, Checkbox, ConfirmDialog, Dialog, Field, Input, Pagination, Select, StateView, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary, dash } from '../common'
import { registerAdminModule } from '../registry'

function SecretDialog({ title, password, onClose }: { title: string; password: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <Dialog open onClose={onClose} title={title} footer={<Button variant="primary" onClick={onClose}>{t('common.close')}</Button>}>
      <p className="muted small" style={{ marginBottom: 12 }}>
        {t('admin.users.tempPasswordNote')}
      </p>
      <div className="secret">
        <code>{password}</code>
        <Button
          size="sm"
          icon={copied ? 'check' : 'copy'}
          onClick={async () => {
            await navigator.clipboard?.writeText(password).catch(() => {})
            setCopied(true)
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </Button>
      </div>
    </Dialog>
  )
}

function CreateUser({ onClose, onSecret }: { onClose: () => void; onSecret: (p: string) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const [d, setD] = useState({ username: '', displayName: '', email: '', password: '' })
  const [picked, setPicked] = useState<string[]>(['Member'])
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () => adminApi.createUser({ ...d, email: d.email || undefined, password: d.password || undefined, roles: picked }),
    onSuccess: (u) => {
      toast.success(t('admin.users.created_ok'))
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      if (u.temporaryPassword) onSecret(u.temporaryPassword)
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
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD((s) => ({ ...s, [k]: e.target.value }))
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.users.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="user-form" loading={m.isPending} disabled={!d.username || !d.displayName}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="user-form" className="form-stack" onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="grid-2">
          <Field label={t('admin.users.username')} error={fields.username}>
            <Input autoFocus autoComplete="off" value={d.username} onChange={set('username')} invalid={!!fields.username} />
          </Field>
          <Field label={t('admin.users.displayName')} error={fields.displayName}>
            <Input value={d.displayName} onChange={set('displayName')} invalid={!!fields.displayName} />
          </Field>
        </div>
        <Field label={t('admin.users.email')}>
          <Input type="email" value={d.email} onChange={set('email')} />
        </Field>
        <Field label={t('admin.users.password')} hint={t('admin.users.passwordHint')} error={fields.password}>
          <Input type="password" autoComplete="new-password" value={d.password} onChange={set('password')} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 8 }}>
            {t('admin.users.roles')}
          </legend>
          <div className="row-gap" style={{ gap: 16 }}>
            {roles.data?.map((r) => (
              <Checkbox
                key={r.id}
                label={r.name}
                checked={picked.includes(r.name)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.name] : p.filter((x) => x !== r.name)))}
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Dialog>
  )
}

function RolesDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const [picked, setPicked] = useState<string[]>(user.roles)
  const m = useMutation({
    mutationFn: () => adminApi.setUserRoles(user.id, roles.data!.filter((r) => picked.includes(r.name)).map((r) => r.id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t('admin.users.setRoles')}: ${user.displayName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={m.isPending} disabled={!picked.length || !roles.data} onClick={() => m.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        {roles.data?.map((r) => (
          <Checkbox
            key={r.id}
            label={
              <>
                {r.name} <span className="muted small">{r.description}</span>
              </>
            }
            checked={picked.includes(r.name)}
            onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.name] : p.filter((x) => x !== r.name)))}
          />
        ))}
      </div>
    </Dialog>
  )
}

function UsersAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)
  const [search, setSearch] = useState('')
  const dq = useDebounced(search, 250)
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [rolesFor, setRolesFor] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)
  const [secret, setSecret] = useState<string | null>(null)

  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const q = useQuery({
    queryKey: ['admin', 'users', dq, role, status, page],
    queryFn: () => adminApi.users({ q: dq, role, status, page, pageSize: 15 }),
    placeholderData: keepPreviousData,
  })
  const inval = () => qc.invalidateQueries({ queryKey: ['admin', 'users'] })
  const toggle = useMutation({
    mutationFn: (u: AdminUser) => (u.status === 'active' ? adminApi.disableUser(u.id) : adminApi.enableUser(u.id)),
    onSuccess: () => void inval(),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const reset = useMutation({
    mutationFn: (id: string) => adminApi.resetPassword(id),
    onSuccess: (r) => setSecret(r.temporaryPassword),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      void inval()
      setDeleting(null)
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      setDeleting(null)
    },
  })

  return (
    <div className="page">
      <PageHeader
        title={t('admin.users.title')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('admin.users.add')}
          </Button>
        }
      />
      <div className="toolbar">
        <Input
          className="grow"
          type="search"
          placeholder={t('admin.users.search')}
          aria-label={t('common.search')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        <Select aria-label={t('admin.users.roles')} value={role} onChange={(e) => (setRole(e.target.value), setPage(1))}>
          <option value="">{t('admin.users.allRoles')}</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.name}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select aria-label={t('admin.users.status')} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">{t('admin.users.allStatus')}</option>
          <option value="active">{t('admin.users.active')}</option>
          <option value="disabled">{t('admin.users.disabled')}</option>
        </Select>
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
                      <th>{t('admin.users.displayName')}</th>
                      <th>{t('admin.users.roles')}</th>
                      <th>{t('admin.users.status')}</th>
                      <th>{t('admin.users.lastLogin')}</th>
                      <th className="col-actions">
                        <span className="sr-only">{t('common.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.items.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <span className="rowline" style={{ gap: 10 }}>
                            <Avatar name={u.displayName} src={u.avatarUrl} size={28} />
                            <span>
                              {u.displayName}
                              <span className="muted small"> @{u.username}</span>
                              <div className="muted small">{dash(u.email)}</div>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="row-gap">
                            {u.roles.map((r) => (
                              <Badge key={r}>{r}</Badge>
                            ))}
                          </span>
                        </td>
                        <td>{u.status === 'active' ? <Badge tone="success">{t('admin.users.active')}</Badge> : <Badge tone="danger">{t('admin.users.disabled')}</Badge>}</td>
                        <td className="num">{u.lastLoginAt ? formatDate(u.lastLoginAt, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                        <td className="col-actions">
                          <span className="row-actions">
                            <Button size="sm" variant="ghost" iconOnly icon="shield" aria-label={t('admin.users.setRoles')} onClick={() => setRolesFor(u)} />
                            <Button size="sm" variant="ghost" iconOnly icon="key" aria-label={t('admin.users.resetPassword')} onClick={() => reset.mutate(u.id)} />
                            <Button size="sm" variant="ghost" disabled={u.id === me?.id} onClick={() => toggle.mutate(u)}>
                              {u.status === 'active' ? t('admin.users.disable') : t('admin.users.enable')}
                            </Button>
                            <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={t('common.delete')} disabled={u.id === me?.id} onClick={() => setDeleting(u)} />
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

      {creating && <CreateUser onClose={() => setCreating(false)} onSecret={setSecret} />}
      {rolesFor && <RolesDialog user={rolesFor} onClose={() => setRolesFor(null)} />}
      {secret && <SecretDialog title={t('admin.users.tempPassword')} password={secret} onClose={() => setSecret(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('admin.users.deleteTitle')}
        body={deleting && t('admin.users.deleteBody', { name: deleting.username })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

registerAdminModule({
  id: 'users',
  group: 'people',
  order: 20,
  label: 'admin.nav.users',
  icon: 'user',
  path: 'users',
  permission: 'users.read',
  element: UsersAdmin,
})
