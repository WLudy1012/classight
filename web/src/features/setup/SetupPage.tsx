import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isMockApi, replaySetupDemo, setupApi, type SetupStatus } from '@/shared/api'
import { setLanguage } from '@/shared/i18n'
import { useDocumentTitle } from '@/shared/hooks'
import { Button, Skeleton, StateView, Stepper, type StepItem } from '@/shared/ui'
import { useAuth } from '@/features/auth/store'
import { AccessStep, AdminStep, CheckStep, DatabaseStep, DoneStep, SiteStep, SpeechStep, WelcomeStep } from './steps'
import type { StepKey } from './types'
import './setup.css'

const ORDER: StepKey[] = ['welcome', 'check', 'database', 'admin', 'site', 'access', 'speech', 'done']
export const setupStatusKey = ['setup', 'status'] as const

/** The first step that still needs doing, from what the server reports. Steps after it stay locked until it is done. */
function frontier(s: SetupStatus, signedIn: boolean): StepKey {
  if (s.state === 'needs_database') return 'database'
  if (s.state === 'needs_admin') return 'admin'
  return signedIn ? 'done' : 'admin'
}

export default function SetupPage() {
  const { t, i18n } = useTranslation()
  useDocumentTitle(t('setup.title'))
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const demo = params.has('demo') && isMockApi()
  const signedIn = useAuth((a) => a.status === 'authenticated')
  const [token, setToken] = useState('')
  const [step, setStep] = useState<StepKey>('welcome')
  const [furthest, setFurthest] = useState(0)
  const [demoReady, setDemoReady] = useState(!demo)

  useEffect(() => {
    if (demoReady) return
    void replaySetupDemo().then(async () => {
      await qc.invalidateQueries({ queryKey: setupStatusKey })
      setDemoReady(true)
    })
  }, [demoReady, qc])

  const q = useQuery({ queryKey: setupStatusKey, queryFn: setupApi.status, enabled: demoReady, retry: false, refetchOnWindowFocus: false })
  const status = q.data

  // A finished setup has nothing to show; visitors go home. (`?demo=1` replays the wizard in mock mode.)
  useEffect(() => {
    if (status?.setupCompleted && !demo) nav('/', { replace: true })
  }, [status?.setupCompleted, demo, nav])

  const stop = status ? ORDER.indexOf(frontier(status, signedIn)) : 0
  // welcome, checks and the frontier step are always open; steps beyond the frontier wait for the server to catch up
  const isLocked = (k: StepKey) => ORDER.indexOf(k) > Math.max(stop, ORDER.indexOf('check')) && !(k === 'done' && stop >= ORDER.indexOf('site'))
  const open = (k: StepKey) => !isLocked(k) || k === 'welcome'

  // after the server catches up (database applied, administrator created) move to the step that now needs doing
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => { setFurthest((previous) => Math.max(previous, ORDER.indexOf(step))) }, [step])
  useEffect(() => {
    if (!status) return
    const key = `${status.state}:${signedIn}`
    if (seen === null) {
      setSeen(key)
      // resuming an unfinished setup: skip straight to the work that is left
      if (status.state === 'ready' && signedIn) setStep('site')
      else if (status.state !== 'needs_database' || status.database.configured) setStep(ORDER[Math.max(stop, 1)]!)
      return
    }
    if (key !== seen) {
      setSeen(key)
      setStep(status.state === 'ready' && signedIn ? 'site' : ORDER[stop]!)
    }
  }, [status, signedIn, seen, stop, step])

  const next = () => setStep((cur) => {
    const n = ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(cur) + 1)]!
    return open(n) ? n : cur
  })
  const back = () => setStep((cur) => ORDER[Math.max(0, ORDER.indexOf(cur) - 1)]!)
  const refresh = () => qc.invalidateQueries({ queryKey: setupStatusKey })

  const items: StepItem[] = useMemo(
    () =>
      ORDER.map((k) => {
        const idx = ORDER.indexOf(k)
        const finished = idx < furthest || (k === 'database' && !!status && status.state !== 'needs_database') || (k === 'admin' && !!status && status.state === 'ready' && signedIn)
        const broken = k === 'database' && !!status && !status.database.connected && !!status.database.error && status.state === 'needs_database'
        const state = isLocked(k) && k !== step ? 'locked' : broken ? 'error' : finished ? 'done' : 'todo'
        return { key: k, label: t(`setup.steps.${k}`), state } as StepItem
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, stop, status, signedIn, furthest, t],
  )

  if (q.isError)
    return (
      <div className="setup setup--center">
        <StateView icon="alert" title={t('common.error')} body={t('setup.check.bad')} action={<Button onClick={() => void q.refetch()}>{t('common.retry')}</Button>} />
      </div>
    )
  if (!status)
    return (
      <div className="setup setup--center">
        <Skeleton w={320} h={24} />
      </div>
    )

  const other = i18n.language === 'en' ? 'zh' : 'en'
  const props = { status, token, refresh, next, back, signedIn }

  return (
    <div className="setup">
      <aside className="setup__rail">
        <div className="setup__brand">
          <span className="shell__mark" aria-hidden="true" />
          <span>{t('setup.title')}</span>
        </div>
        <p className="setup__progress num" aria-live="polite">{i18n.language.startsWith('en') ? `Step ${ORDER.indexOf(step) + 1} of ${ORDER.length}` : `第 ${ORDER.indexOf(step) + 1} / ${ORDER.length} 步`} · {t(`setup.steps.${step}`)}</p>
        <Stepper steps={items} current={step} onSelect={(k) => setStep(k as StepKey)} label={t('setup.title')} />
        <div className="setup__rail-foot">
          {isMockApi() && <p className="muted small">{t('setup.demoNote')}</p>}
          <Button variant="ghost" size="sm" icon="globe" onClick={() => setLanguage(other)}>
            {other === 'en' ? 'EN' : '中文'}
          </Button>
        </div>
      </aside>

      <main className="setup__main">
        <div className="setup__panel glass" key={step}>
          <i className="setup__c setup__c--tl" />
          <i className="setup__c setup__c--tr" />
          <i className="setup__c setup__c--bl" />
          <i className="setup__c setup__c--br" />
          {step === 'welcome' && <WelcomeStep {...props} setToken={setToken} resuming={status.state !== 'needs_database'} />}
          {step === 'check' && <CheckStep {...props} />}
          {step === 'database' && <DatabaseStep {...props} setToken={setToken} />}
          {step === 'admin' && <AdminStep {...props} setToken={setToken} />}
          {step === 'site' && <SiteStep {...props} />}
          {step === 'access' && <AccessStep {...props} />}
          {step === 'speech' && <SpeechStep {...props} />}
          {step === 'done' && <DoneStep {...props} onFinished={() => nav('/', { replace: true })} />}
        </div>
      </main>
    </div>
  )
}
