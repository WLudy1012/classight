import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type Permission, type Role } from '@/shared/api'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Field, Input, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

function NewRole({ onClose, onCreated }: { onClose: () => void; onCreated: (r: Role) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const m = useMutation({
    mutationFn: () => adminApi.createRole({ name: name.trim(), description, permissions: [] }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'roles'] })
      onCreated(r)
      onClose()
    },
    onError: (e) => {
      setFields(fieldErrors(e))
      toast.error(errorMessage(e))
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    m.mutate()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('admin.roles.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="role-form" loading={m.isPending} disabled={!name.trim()}>
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form id="role-form" className="form-stack" onSubmit={submit}>
        <Field label={t('admin.roles.name')} error={fields.name}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} invalid={!!fields.name} />
        </Field>
        <Field label={t('admin.roles.description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  )
}

function RolesAdmin() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const roles = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.roles })
  const perms = useQuery({ queryKey: ['admin', 'permissions'], queryFn: adminApi.permissions })
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Permission[]>([])
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)

  const selected = roles.data?.find((r) => r.id === selId) ?? roles.data?.[0]
  useEffect(() => {
    if (selected) setDraft(selected.permissions)
  }, [selected])

  const locked = selected?.name === 'SuperAdmin'
  const dirty = !!selected && JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.permissions].sort())

  const save = useMutation({
    mutationFn: () => adminApi.updateRole(selected!.id, { name: selected!.name, description: selected!.description, permissions: draft }),
    onSuccess: () => {
      toast.success(t('admin.roles.saved'))
      void qc.invalidateQueries({ queryKey: ['admin', 'roles'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteRole(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'roles'] })
      setSelId(null)
      setDeleting(null)
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      setDeleting(null)
    },
  })

  const toggle = (code: Permission, on: boolean) => setDraft((d) => (on ? [...new Set([...d, code])] : d.filter((x) => x !== code)))

  return (
    <div className="page">
      <PageHeader
        title={t('admin.roles.title')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {t('admin.roles.add')}
          </Button>
        }
      />
      <QueryBoundary pending={roles.isPending || perms.isPending} error={roles.error ?? perms.error} onRetry={() => { void roles.refetch(); void perms.refetch() }}>
        {roles.data && perms.data && selected && (
          <div className="split">
            <div className="rolelist" role="list">
              {roles.data.map((r) => (
                <button key={r.id} role="listitem" aria-current={r.id === selected.id} onClick={() => setSelId(r.id)}>
                  <span>{r.name}</span>
                  {r.builtIn && <Badge>{t('admin.roles.builtIn')}</Badge>}
                </button>
              ))}
            </div>
            <section aria-label={selected.name}>
              <div className="row-between">
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)' }}>{selected.name}</h2>
                  <p className="muted small">{selected.description}</p>
                </div>
                <span className="row-gap">
                  {!selected.builtIn && (
                    <Button variant="danger" size="sm" icon="trash" onClick={() => setDeleting(selected)}>
                      {t('common.delete')}
                    </Button>
                  )}
                  <Button variant="primary" size="sm" disabled={!dirty || locked} loading={save.isPending} onClick={() => save.mutate()}>
                    {t('common.save')}
                  </Button>
                </span>
              </div>
              {locked && <p className="readonly-note">{t('admin.roles.locked')}</p>}
              <div className="perm-grid">
                {perms.data.map((g) => (
                  <div key={g.module} className="perm-group">
                    <h4>{g.module}</h4>
                    <div className="perm-list">
                      {g.permissions.map((p) => (
                        <Checkbox
                          key={p.code}
                          label={<span className="mono">{p.code}</span>}
                          checked={draft.includes(p.code)}
                          disabled={locked}
                          onChange={(e) => toggle(p.code, e.target.checked)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </QueryBoundary>
      {creating && <NewRole onClose={() => setCreating(false)} onCreated={(r) => setSelId(r.id)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('admin.roles.deleteTitle')}
        body={deleting && t('admin.roles.deleteBody', { name: deleting.name })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

registerAdminModule({
  id: 'roles',
  group: 'people',
  order: 21,
  label: 'admin.nav.roles',
  icon: 'shield',
  path: 'roles',
  permission: 'roles.manage',
  element: RolesAdmin,
})
