import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi, api, setupApi, type DatabaseProvider } from '@/shared/api'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { Badge, Button, Checkbox, Field, Icon, Input, Select, Skeleton, StateView, Switch, TabPanel, Tabs, toast, useTabsId } from '@/shared/ui'
import { useAuth } from '@/features/auth/store'
import { buildConnectionString, DEFAULT_PORT, emptyFields, missingFields, passwordStrength, type DbFields } from './connection'
import type { StepProps } from './types'

function Head({ title, body }: { title: ReactNode; body?: ReactNode }) {
  return (
    <header className="sstep__head">
      <h1 className="sstep__title">{title}</h1>
      {body && <p className="sstep__body">{body}</p>}
    </header>
  )
}

function Nav({ back, next, nextLabel, disabled, loading, onNext, hideBack }: { back?: () => void; next?: () => void; nextLabel?: string; disabled?: boolean; loading?: boolean; onNext?: () => void; hideBack?: boolean }) {
  const { t } = useTranslation()
  return (
    <footer className="sstep__nav">
      {!hideBack && back ? (
        <Button variant="ghost" icon="arrowLeft" onClick={back}>
          {t('setup.back')}
        </Button>
      ) : (
        <span />
      )}
      <Button variant="primary" iconRight="arrowRight" disabled={disabled} loading={loading} onClick={onNext ?? next}>
        {nextLabel ?? t('setup.next')}
      </Button>
    </footer>
  )
}

const Err = ({ message }: { message: string }) =>
  message ? (
    <div className="form-error" role="alert">
      {message}
    </div>
  ) : null

/** Needs-an-administrator notice for steps that write settings. */
function NeedAdmin() {
  const { t } = useTranslation()
  return (
    <div className="readonly-note">
      {t('setup.needAdmin')} <Link to="/login">{t('auth.login')}</Link>
    </div>
  )
}

function SetupToken({ token, setToken }: { token: string; setToken: (token: string) => void }) {
  const { t } = useTranslation()
  return <Field label={t('setup.welcome.token')} hint={t('setup.welcome.tokenHint')}><Input type="password" value={token} onChange={(event) => setToken(event.target.value.trim())} autoComplete="off" spellCheck={false} /></Field>
}

/* ---------------------------------------------------------------- welcome */
export function WelcomeStep({ status, setToken, token, next, resuming }: StepProps & { setToken: (t: string) => void; resuming: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      <Head title={t('setup.welcome.title')} body={t('setup.welcome.body')} />
      {resuming && <p className="readonly-note">{t('setup.welcome.resume')}</p>}
      {status.tokenRequired ? (
        <Field label={t('setup.welcome.token')} hint={t('setup.welcome.tokenHint')}>
          <Input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="xxxxxxxxxxxxxxxxxxxxxxxx" />
        </Field>
      ) : (
        <p className="muted small">{t('setup.welcome.tokenOptional')}</p>
      )}
      <Nav hideBack nextLabel={t('setup.welcome.next')} next={next} disabled={status.tokenRequired && !token} />
    </>
  )
}

/* ------------------------------------------------------------------ check */
export function CheckStep({ status, refresh, next, back }: StepProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const row = (ok: boolean | null, label: string, detail: ReactNode) => (
    <li className="check-row" data-ok={ok === null ? 'pending' : ok}>
      <span className="check-row__dot" aria-hidden="true" />
      <span className="check-row__label">{label}</span>
      <span className="check-row__detail">{detail}</span>
      <Badge tone={ok === null ? undefined : ok ? 'success' : 'danger'}>{ok === null ? t('setup.check.pending') : ok ? t('setup.check.ok') : t('setup.check.bad')}</Badge>
    </li>
  )
  const dbOk = status.database.configured ? status.database.connected : null
  return (
    <>
      <Head title={t('setup.check.title')} />
      <ul className="checks">
        {row(true, t('setup.check.backend'), `${status.version} · ${status.environment}`)}
        {row(dbOk, t('setup.check.database'), status.database.configured ? `${t(`setup.db.provider.${status.database.provider}`)}${status.database.error ? ` · ${status.database.error}` : ''}` : t('setup.db.createFirst'))}
        {row(status.storage.writable, t('setup.check.storage'), <span className="mono">{status.storage.path}</span>)}
        {row(true, t('setup.check.converter'), status.converter.available ? t('setup.check.converterOn') : t('setup.check.converterOff'))}
        {row(!status.jwtKeyIsDefault, t('setup.check.jwt'), status.jwtKeyIsDefault ? t('setup.check.jwtDefault') : t('setup.check.jwtOk'))}
      </ul>
      <div>
        <Button
          size="sm"
          icon="refresh"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            await refresh()
            setBusy(false)
          }}
        >
          {t('setup.check.recheck')}
        </Button>
      </div>
      <Nav back={back} next={next} />
    </>
  )
}

/* --------------------------------------------------------------- database */
export function DatabaseStep({ status, token, setToken, refresh, next, back }: StepProps & { setToken: (token: string) => void }) {
  const { t } = useTranslation()
  const idBase = useTabsId()
  const sqlite = status.sqliteAllowed !== false && status.environment !== 'Production'
  const providers: DatabaseProvider[] = sqlite ? ['PostgreSql', 'MySql', 'Sqlite'] : ['PostgreSql', 'MySql']
  const [provider, setProvider] = useState<DatabaseProvider>(sqlite && status.environment === 'Development' ? 'Sqlite' : 'PostgreSql')
  const [fields, setFields] = useState<DbFields>(() => emptyFields(provider))
  const [raw, setRaw] = useState(false)
  const [rawValue, setRawValue] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const done = status.state !== 'needs_database'

  const connection = raw ? rawValue.trim() : buildConnectionString(provider, fields)
  const incomplete = (raw ? !rawValue.trim() : missingFields(provider, fields).length > 0) || (status.tokenRequired && !token)
  const input = { provider, connectionString: connection }

  const pick = (p: DatabaseProvider) => {
    setProvider(p)
    setFields((f) => ({ ...emptyFields(p), host: f.host, database: f.database, password: '' }))
    setResult(null)
  }
  const test = useMutation({
    mutationFn: (candidate: typeof input) => setupApi.testDatabase(candidate, token),
    onSuccess: (r) => setResult({ ok: true, text: [r.message ?? t('setup.db.testOk'), r.serverVersion && t('setup.db.testVersion', { v: r.serverVersion })].filter(Boolean).join(' · ') }),
    onError: (e) => setResult({ ok: false, text: errorMessage(e) }),
  })
  const apply = useMutation({
    mutationFn: () => setupApi.applyDatabase(input, token),
    onSuccess: async () => {
      toast.success(t('setup.db.applied'))
      setFields((f) => ({ ...f, password: '' }))
      setRawValue('')
      await refresh()
    },
    onError: (e) => setResult({ ok: false, text: errorMessage(e) }),
  })
  const set = (k: keyof DbFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setFields((f) => ({ ...f, [k]: e.target.value }))
    setResult(null)
  }
  const tested = result?.ok === true && test.isSuccess && test.variables.provider === provider && test.variables.connectionString === connection

  if (done)
    return (
      <>
        <Head title={t('setup.db.title')} />
        <div className="okbox">
          <Icon name="checkCircle" size={22} />
          <div>
            <strong>{t('setup.db.applied')}</strong>
            <div className="muted small">{t(`setup.db.provider.${status.database.provider}`)}</div>
          </div>
        </div>
        <Nav back={back} next={next} />
      </>
    )

  return (
    <>
      <Head title={t('setup.db.title')} body={t('setup.db.body')} />
      {status.tokenRequired && <SetupToken token={token} setToken={setToken} />}
      <Tabs
        idBase={idBase}
        label={t('setup.db.title')}
        value={provider}
        onChange={pick}
        tabs={providers.map((p) => ({ key: p, label: t(`setup.db.provider.${p}`) }))}
      />
      <TabPanel idBase={idBase} tabKey={provider} value={provider}>
        <form
          className="form-stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (!incomplete && tested && !test.isPending && !apply.isPending) apply.mutate()
          }}
        >
          {provider === 'Sqlite' && <p className="readonly-note">{t('setup.db.sqliteOnly')}</p>}
          {raw ? (
            <Field label={t('setup.db.connectionString')}>
              <Input value={rawValue} onChange={(e) => (setRawValue(e.target.value), setResult(null))} autoComplete="off" spellCheck={false} type="password" />
            </Field>
          ) : provider === 'Sqlite' ? (
            <Field label={t('setup.db.file')}>
              <Input value={fields.file} onChange={set('file')} spellCheck={false} />
            </Field>
          ) : (
            <>
              <div className="grid-2">
                <Field label={t('setup.db.host')}>
                  <Input value={fields.host} onChange={set('host')} spellCheck={false} />
                </Field>
                <Field label={t('setup.db.port')}>
                  <Input value={fields.port} onChange={set('port')} inputMode="numeric" placeholder={DEFAULT_PORT[provider]} />
                </Field>
              </div>
              <Field label={t('setup.db.database')}>
                <Input value={fields.database} onChange={set('database')} spellCheck={false} />
              </Field>
              <div className="grid-2">
                <Field label={t('setup.db.username')}>
                  <Input value={fields.username} onChange={set('username')} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label={t('setup.db.password')}>
                  <Input type="password" value={fields.password} onChange={set('password')} autoComplete="new-password" />
                </Field>
              </div>
            </>
          )}
          <button type="button" className="linkbtn" onClick={() => { setRaw((r) => !r); setResult(null) }}>
            {raw ? t('setup.db.fields') : t('setup.db.raw')}
          </button>
          {result && test.variables?.provider === provider && test.variables?.connectionString === connection && (
            <div className={result.ok ? 'okbox' : 'form-error'} role={result.ok ? 'status' : 'alert'}>
              {result.ok && <Icon name="checkCircle" size={18} />}
              {result.text}
            </div>
          )}
          <div className="row-gap">
            <Button type="button" icon="activity" loading={test.isPending} disabled={incomplete || apply.isPending} onClick={() => test.mutate(input)}>
              {test.isPending ? t('setup.db.testing') : t('setup.db.test')}
            </Button>
            <Button type="submit" variant="primary" loading={apply.isPending} disabled={incomplete || !tested || test.isPending}>
              {apply.isPending ? t('setup.db.applying') : t('setup.db.apply')}
            </Button>
          </div>
        </form>
      </TabPanel>
      <Nav back={back} next={next} disabled hideBack={false} />
    </>
  )
}

/* ------------------------------------------------------------------ admin */
export function AdminStep({ status, token, setToken, refresh, next, back, signedIn }: StepProps & { setToken: (token: string) => void }) {
  const { t } = useTranslation()
  const meName = useAuth((a) => a.user?.displayName ?? '')
  const [f, setF] = useState({ username: 'admin', displayName: '', email: '', password: '', again: '' })
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const strength = passwordStrength(f.password)
  const m = useMutation({
    mutationFn: () => setupApi.createAdmin({ username: f.username.trim(), displayName: f.displayName.trim() || f.username.trim(), password: f.password, email: f.email.trim() || undefined }, token),
    onSuccess: async (r) => {
      api.setAccessToken(r.accessToken)
      useAuth.setState({ status: 'authenticated', user: r.user, sessionLost: false })
      toast.success(t('setup.admin.created', { name: r.user.displayName }))
      setF((s) => ({ ...s, password: '', again: '' }))
      await refresh()
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
    if (f.password !== f.again) return setFields({ again: t('setup.admin.mismatch') })
    m.mutate()
  }

  if (status.state === 'needs_database')
    return (
      <>
        <Head title={t('setup.admin.title')} />
        <p className="readonly-note">{t('setup.db.createFirst')}</p>
        <Nav back={back} next={next} disabled />
      </>
    )
  if (status.state === 'ready')
    return (
      <>
        <Head title={t('setup.admin.title')} />
        {signedIn ? (
          <div className="okbox">
            <Icon name="checkCircle" size={22} />
            <strong>{t('setup.admin.created', { name: meName })}</strong>
          </div>
        ) : (
          <NeedAdmin />
        )}
        <Nav back={back} next={next} disabled={!signedIn} />
      </>
    )

  return (
    <>
      <Head title={t('setup.admin.title')} body={t('setup.admin.body')} />
      {status.tokenRequired && <SetupToken token={token} setToken={setToken} />}
      <form className="form-stack" onSubmit={submit} noValidate>
        <Err message={error} />
        <div className="grid-2">
          <Field label={t('setup.admin.username')} error={fields.username}>
            <Input autoFocus value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" invalid={!!fields.username} />
          </Field>
          <Field label={t('setup.admin.displayName')} error={fields.displayName}>
            <Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} invalid={!!fields.displayName} />
          </Field>
        </div>
        <Field label={t('setup.admin.email')} error={fields.email}>
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" />
        </Field>
        <Field label={t('setup.admin.password')} error={fields.password}>
          <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" invalid={!!fields.password} />
        </Field>
        <div className="strength" data-level={strength.level} aria-live="polite">
          <span className="strength__bars" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <i key={i} data-on={strength.score >= i || undefined} />
            ))}
          </span>
          {f.password && <span className="small">{t(`setup.admin.strength.${strength.level}`)}</span>}
        </div>
        <Field label={t('setup.admin.again')} error={fields.again}>
          <Input type="password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} autoComplete="new-password" invalid={!!fields.again} />
        </Field>
        <div className="row-gap">
          <Button type="submit" variant="primary" loading={m.isPending} disabled={!f.username.trim() || !f.password || !f.again || (status.tokenRequired && !token)}>
            {t('setup.admin.create')}
          </Button>
        </div>
      </form>
      <Nav back={back} next={next} disabled />
    </>
  )
}

/* -------------------------------------------- settings steps (need a login) */
function useGroup<K extends 'site' | 'appearance' | 'security' | 'speech'>(group: K, enabled: boolean) {
  const q = useQuery({ queryKey: ['setup', 'settings', group], queryFn: () => adminApi.settingsGroup(group), enabled, retry: false })
  return q
}

function SettingsUnavailable({ error, retry }: { error?: unknown; retry: () => void }) {
  const { t } = useTranslation()
  return error ? <StateView icon="alert" title={t('common.error')} body={errorMessage(error)} action={<Button onClick={retry}>{t('common.retry')}</Button>} /> : <Skeleton w="100%" h={100} />
}

export function SiteStep({ signedIn, next, back }: StepProps) {
  const { t } = useTranslation()
  const site = useGroup('site', signedIn)
  const look = useGroup('appearance', signedIn)
  const qc = useQueryClient()
  const hydrated = useRef(false)
  const [v, setV] = useState({ className: '', classNameEn: '', slogan: '', particleColor: '#0b1220' })
  const [error, setError] = useState('')
  useEffect(() => {
    if (site.data && look.data && !hydrated.current) {
      hydrated.current = true
      setV({ className: site.data.values.className, classNameEn: site.data.values.classNameEn, slogan: site.data.values.slogan, particleColor: look.data.values.particleColor })
    }
  }, [site.data, look.data])
  const save = useMutation({
    mutationFn: async () => {
      const savedSite = await adminApi.saveSettings('site', { className: v.className.trim(), classNameEn: v.classNameEn.trim(), slogan: v.slogan.trim() }, site.data!.version)
      qc.setQueryData(['setup', 'settings', 'site'], savedSite)
      const savedLook = await adminApi.saveSettings('appearance', { particleColor: v.particleColor }, look.data!.version)
      qc.setQueryData(['setup', 'settings', 'appearance'], savedLook)
    },
    onSuccess: next,
    onError: (e) => setError(errorMessage(e)),
  })
  if (!signedIn)
    return (
      <>
        <Head title={t('setup.site.title')} />
        <NeedAdmin />
        <Nav back={back} next={next} disabled />
      </>
    )
  if (!site.data || !look.data)
    return <><Head title={t('setup.site.title')} /><SettingsUnavailable error={site.error ?? look.error} retry={() => { void site.refetch(); void look.refetch() }} /><Nav back={back} next={next} disabled /></>
  return (
    <>
      <Head title={t('setup.site.title')} body={t('setup.site.body')} />
      <div className="split-preview">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault()
            setError('')
            save.mutate()
          }}
        >
          <Err message={error} />
          <Field label={t('setup.site.className')}>
            <Input autoFocus value={v.className} onChange={(e) => setV({ ...v, className: e.target.value })} maxLength={100} />
          </Field>
          <Field label={t('setup.site.classNameEn')}>
            <Input value={v.classNameEn} onChange={(e) => setV({ ...v, classNameEn: e.target.value })} maxLength={100} />
          </Field>
          <Field label={t('setup.site.slogan')}>
            <Input value={v.slogan} onChange={(e) => setV({ ...v, slogan: e.target.value })} maxLength={500} />
          </Field>
          <Field label={t('setup.site.particle')}>
            <Input type="color" value={v.particleColor} onChange={(e) => setV({ ...v, particleColor: e.target.value })} style={{ padding: 4, width: 96 }} />
          </Field>
          <button type="submit" hidden />
        </form>
        <div className="mini" aria-label={t('setup.site.preview')}>
          <i className="mini__c mini__c--tl" />
          <i className="mini__c mini__c--tr" />
          <i className="mini__c mini__c--bl" />
          <i className="mini__c mini__c--br" />
          <span className="mini__name" style={{ color: v.particleColor }}>
            {v.className || '—'}
          </span>
          <span className="mini__slogan">{v.slogan}</span>
        </div>
      </div>
      <Nav back={back} nextLabel={t('setup.saveNext')} onNext={() => { setError(''); save.mutate() }} loading={save.isPending} disabled={!v.className.trim()} />
    </>
  )
}

export function AccessStep({ signedIn, next, back }: StepProps) {
  const { t } = useTranslation()
  const sec = useGroup('security', signedIn)
  const [mode, setMode] = useState<'invite' | 'closed'>('invite')
  const [pub, setPub] = useState(true)
  const [uses, setUses] = useState('40')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (sec.data) {
      setMode(sec.data.values.registrationMode)
      setPub(sec.data.values.classInfoPublic)
    }
  }, [sec.data])
  const invite = useMutation({
    mutationFn: () => adminApi.createInvite({ maxUses: Math.max(1, Number(uses) || 1), role: 'Member' }),
    onSuccess: (i) => setCode(i.code),
    onError: (e) => setError(errorMessage(e)),
  })
  const save = useMutation({
    mutationFn: () => adminApi.saveSettings('security', { registrationMode: mode, classInfoPublic: pub }, sec.data!.version),
    onSuccess: next,
    onError: (e) => setError(errorMessage(e)),
  })
  if (!signedIn)
    return (
      <>
        <Head title={t('setup.access.title')} />
        <NeedAdmin />
        <Nav back={back} next={next} disabled />
      </>
    )
  if (!sec.data)
    return <><Head title={t('setup.access.title')} /><SettingsUnavailable error={sec.error} retry={() => void sec.refetch()} /><Nav back={back} next={next} disabled /></>
  return (
    <>
      <Head title={t('setup.access.title')} body={t('setup.access.body')} />
      <div className="form-stack">
        <Err message={error} />
        <Field label={t('setup.access.registration')}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'invite' | 'closed')}>
            <option value="invite">{t('setup.access.invite')}</option>
            <option value="closed">{t('setup.access.closed')}</option>
          </Select>
        </Field>
        <Switch label={t('setup.access.classPublic')} checked={pub} onChange={(e) => setPub(e.target.checked)} />
        {mode === 'invite' && (
          <div className="invite-make">
            <Field label={t('setup.access.inviteUses')}>
              <Input type="number" min={1} value={uses} onChange={(e) => setUses(e.target.value)} style={{ width: 120 }} />
            </Field>
            <Button icon="ticket" loading={invite.isPending} onClick={() => invite.mutate()}>
              {t('setup.access.makeInvite')}
            </Button>
            {code && (
              <div className="secret" role="status">
                <span className="muted small">{t('setup.access.inviteMade')}</span>
                <code>{code}</code>
                <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(code)}>
                  {t('common.copy')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <Nav back={back} nextLabel={t('setup.saveNext')} onNext={() => { setError(''); save.mutate() }} loading={save.isPending} />
    </>
  )
}

export function SpeechStep({ signedIn, next, back }: StepProps) {
  const { t } = useTranslation()
  const q = useGroup('speech', signedIn)
  const [v, setV] = useState({ defaultSlotMinutes: 5, allowTeams: true, maxTeamSize: 4, maxCoursewareMb: 50 })
  const [error, setError] = useState('')
  useEffect(() => {
    if (q.data) setV(q.data.values)
  }, [q.data])
  const save = useMutation({ mutationFn: () => adminApi.saveSettings('speech', v, q.data!.version), onSuccess: next, onError: (e) => setError(errorMessage(e)) })
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) })
  if (!signedIn)
    return (
      <>
        <Head title={t('setup.speech.title')} />
        <NeedAdmin />
        <Nav back={back} next={next} disabled />
      </>
    )
  if (!q.data)
    return <><Head title={t('setup.speech.title')} /><SettingsUnavailable error={q.error} retry={() => void q.refetch()} /><Nav back={back} next={next} disabled /></>
  return (
    <>
      <Head title={t('setup.speech.title')} body={t('setup.speech.body')} />
      <div className="form-stack">
        <Err message={error} />
        <div className="grid-2">
          <Field label={t('admin.speech.slot')}>
            <Input type="number" min={1} max={60} value={v.defaultSlotMinutes} onChange={num('defaultSlotMinutes')} />
          </Field>
          <Field label={t('admin.speech.maxTeam')}>
            <Input type="number" min={2} max={20} value={v.maxTeamSize} onChange={num('maxTeamSize')} disabled={!v.allowTeams} />
          </Field>
        </div>
        <Switch label={t('admin.speech.allowTeams')} checked={v.allowTeams} onChange={(e) => setV({ ...v, allowTeams: e.target.checked })} />
        <Field label={`${t('queue.courseware')} (MB)`}>
          <Input type="number" min={1} max={200} value={v.maxCoursewareMb} onChange={num('maxCoursewareMb')} style={{ width: 140 }} />
        </Field>
      </div>
      <Nav back={back} nextLabel={t('setup.saveNext')} onNext={() => { setError(''); save.mutate() }} loading={save.isPending} />
    </>
  )
}

/* ------------------------------------------------------------------- done */
export function DoneStep({ status, back, onFinished, signedIn }: StepProps & { onFinished: () => void }) {
  const { t } = useTranslation()
  const site = useGroup('site', signedIn)
  const qc = useQueryClient()
  const me = useAuth((a) => a.user)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const finish = useMutation({
    mutationFn: setupApi.complete,
    onSuccess: async () => {
      // the gate caches the status: refresh it before leaving so the home page is not bounced back here
      await qc.invalidateQueries({ queryKey: ['setup', 'status'] })
      onFinished()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  return (
    <>
      <Head title={t('setup.done.title')} body={t('setup.done.body')} />
      {!signedIn ? (
        <NeedAdmin />
      ) : (
        <dl className="summary">
          <div>
            <dt>{t('setup.steps.database')}</dt>
            <dd>{t(`setup.db.provider.${status.database.provider}`)}</dd>
          </div>
          <div>
            <dt>{t('setup.steps.admin')}</dt>
            <dd>{me?.displayName}</dd>
          </div>
          <div>
            <dt>{t('setup.site.className')}</dt>
            <dd>{site.data?.values.className ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('setup.check.converter')}</dt>
            <dd>{status.converter.available ? t('setup.check.ok') : t('setup.check.converterOff')}</dd>
          </div>
        </dl>
      )}
      <Err message={error} />
      <Checkbox label={t('setup.done.summary')} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
      <Nav back={back} nextLabel={finish.isPending ? t('setup.done.finishing') : t('setup.done.finish')} onNext={() => finish.mutate()} loading={finish.isPending} disabled={!signedIn || !confirmed} />
    </>
  )
}
