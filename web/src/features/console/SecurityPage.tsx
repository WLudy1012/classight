import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '@/shared/api'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { useAuth } from '@/features/auth/store'
import { Badge, Button, Field, Input, Skeleton, toast } from '@/shared/ui'

function PasswordForm() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () => authApi.changePassword({ currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      toast.success(t('console.passwordChanged'))
      setCur('')
      setNext('')
      setAgain('')
      void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] })
    },
    onError: (err) => {
      setError(errorMessage(err))
      setFields(fieldErrors(err))
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setFields({})
    if (next !== again) {
      setFields({ again: t('console.mismatch') })
      return
    }
    m.mutate()
  }

  return (
    <form className="form-stack form-narrow" onSubmit={submit} noValidate>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <Field label={t('console.currentPassword')} error={fields.currentPassword}>
        <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} invalid={!!fields.currentPassword} />
      </Field>
      <Field label={t('console.newPassword')} error={fields.newPassword}>
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} invalid={!!fields.newPassword} />
      </Field>
      <Field label={t('console.confirmPassword')} error={fields.again}>
        <Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} invalid={!!fields.again} />
      </Field>
      <div>
        <Button type="submit" variant="primary" loading={m.isPending} disabled={!cur || !next || !again}>
          {t('console.changePassword')}
        </Button>
      </div>
    </form>
  )
}

export function SecurityPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const nav = useNavigate()
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: authApi.sessions })
  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const all = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: async () => {
      await useAuth.getState().logout().catch(() => {})
      nav('/login', { replace: true })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className={embedded ? 'account-panel' : 'page'}>
      {!embedded && <h1 className="page__title">{t('console.securityTitle')}</h1>}

      <section className="page__section" aria-labelledby="s-pw">
        <h2 id="s-pw" className="page__h">
          {t('console.changePassword')}
        </h2>
        <PasswordForm />
      </section>

      <section className="page__section" aria-labelledby="s-ses">
        <div className="row-between">
          <h2 id="s-ses" className="page__h">
            {t('console.sessions')}
          </h2>
          <Button size="sm" variant="danger" loading={all.isPending} onClick={() => all.mutate()}>
            {t('console.logoutAll')}
          </Button>
        </div>
        {sessions.isPending ? (
          <Skeleton h={64} />
        ) : sessions.isError ? (
          <p className="form-error">{errorMessage(sessions.error)}</p>
        ) : (
          <ul className="sessions">
            {sessions.data.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.device}</strong> {s.current && <Badge tone="solid">{t('console.thisDevice')}</Badge>}
                  <div className="muted small num">
                    {s.ip} · {t('console.signedIn', { time: formatDate(s.createdAt, { dateStyle: 'medium', timeStyle: 'short' }) })}
                  </div>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}>
                    {t('console.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
