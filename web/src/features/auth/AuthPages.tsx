import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { useClassName, useSite } from '@/shared/site'
import { Button, Field, Input } from '@/shared/ui'
import { useAuth } from './store'
import { CaptchaWidget, useCaptcha } from './Captcha'
import './auth.css'

function useRedirect() {
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/center'
}

export function LoginPage() {
  const { t } = useTranslation()
  const site = useSite().data
  const name = useClassName(site)
  useDocumentTitle(`${t('auth.login')} · ${name}`)
  const { status, login } = useAuth()
  const nav = useNavigate()
  const to = useRedirect()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const captcha = useCaptcha()

  if (status === 'authenticated') return <Navigate to={to} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setFields({})
    try {
      await login({ account: account.trim(), password, captcha: captcha.proof })
      nav(to, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setFields(fieldErrors(err))
      captcha.reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell back>
      <main className="auth">
        <form className="auth__panel glass" onSubmit={submit} noValidate>
          <i className="auth__c auth__c--tl" />
          <i className="auth__c auth__c--tr" />
          <i className="auth__c auth__c--bl" />
          <i className="auth__c auth__c--br" />
          <div>
            <h1 className="auth__title">{t('auth.loginTitle', { name })}</h1>
            <p className="auth__sub">{t('auth.loginSub')}</p>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <Field label={t('auth.account')} error={fields.account}>
            <Input
              autoFocus
              autoComplete="username"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              invalid={!!fields.account}
              required
            />
          </Field>
          <Field label={t('auth.password')} error={fields.password}>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!fields.password}
              required
            />
          </Field>
          {captcha.config?.enabled && <CaptchaWidget key={captcha.generation} config={captcha.config} onProof={captcha.setProof} />}
          {captcha.failed && <div className="form-error" role="alert">{t('common.error')}</div>}
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!account || !password || captcha.pending || captcha.failed || (captcha.config?.enabled && !captcha.proof)}>
            {busy ? t('auth.submitting') : t('auth.submit')}
          </Button>
          <p className="auth__alt">
            {t('auth.noAccount')} <Link to="/register">{t('auth.toRegister')}</Link>
          </p>
          {import.meta.env.VITE_API_MODE !== 'http' && <p className="auth__demo">{t('auth.demoHint')}</p>}
        </form>
      </main>
    </PageShell>
  )
}

export function RegisterPage() {
  const { t } = useTranslation()
  const site = useSite().data
  const name = useClassName(site)
  useDocumentTitle(`${t('auth.registerTitle', { name })}`)
  const { status, register } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ inviteCode: '', username: '', displayName: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const captcha = useCaptcha()

  if (status === 'authenticated') return <Navigate to="/center" replace />
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }))

  const closed = site?.registrationMode === 'closed'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setFields({})
    try {
      await register({
        inviteCode: f.inviteCode.trim(),
        username: f.username.trim(),
        displayName: f.displayName.trim(),
        password: f.password,
        email: f.email.trim() || undefined,
        captcha: captcha.proof,
      })
      nav('/center', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setFields(fieldErrors(err))
      captcha.reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell back>
      <main className="auth">
        <form className="auth__panel glass" onSubmit={submit} noValidate>
          <i className="auth__c auth__c--tl" />
          <i className="auth__c auth__c--tr" />
          <i className="auth__c auth__c--bl" />
          <i className="auth__c auth__c--br" />
          <div>
            <h1 className="auth__title">{t('auth.registerTitle', { name })}</h1>
            <p className="auth__sub">{closed ? t('auth.closed') : t('auth.registerSub')}</p>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <fieldset className="auth__set" disabled={closed || busy}>
            <Field label={t('auth.inviteCode')} error={fields.inviteCode}>
              <Input autoFocus value={f.inviteCode} onChange={set('inviteCode')} invalid={!!fields.inviteCode} required />
            </Field>
            <Field label={t('auth.username')} error={fields.username}>
              <Input autoComplete="username" value={f.username} onChange={set('username')} invalid={!!fields.username} required />
            </Field>
            <Field label={t('auth.displayName')} error={fields.displayName}>
              <Input value={f.displayName} onChange={set('displayName')} invalid={!!fields.displayName} required />
            </Field>
            <Field label={t('auth.email')} error={fields.email}>
              <Input type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            </Field>
            <Field label={t('auth.newPassword')} error={fields.password}>
              <Input
                type="password"
                autoComplete="new-password"
                value={f.password}
                onChange={set('password')}
                invalid={!!fields.password}
                required
              />
            </Field>
          </fieldset>
          {captcha.config?.enabled && <CaptchaWidget key={captcha.generation} config={captcha.config} onProof={captcha.setProof} />}
          {captcha.failed && <div className="form-error" role="alert">{t('common.error')}</div>}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            disabled={closed || !f.inviteCode || !f.username || !f.displayName || !f.password || captcha.pending || captcha.failed || (captcha.config?.enabled && !captcha.proof)}
          >
            {t('auth.registerSubmit')}
          </Button>
          <p className="auth__alt">
            {t('auth.haveAccount')} <Link to="/login">{t('auth.toLogin')}</Link>
          </p>
        </form>
      </main>
    </PageShell>
  )
}
