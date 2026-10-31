import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type QualityTier, type SettingsGroupKey, type SettingsGroupMap } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { siteKey } from '@/shared/site'
import { Button, Field, Input, Select, Switch, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

const TABS: SettingsGroupKey[] = ['site', 'appearance', 'security', 'storage']

function GroupForm<K extends SettingsGroupKey>({ group, readOnly }: { group: K; readOnly: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'settings', group], queryFn: () => adminApi.settingsGroup(group) })
  const [v, setV] = useState<SettingsGroupMap[K] | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    if (q.data) setV(q.data.values)
  }, [q.data])

  const save = useMutation({
    mutationFn: () => adminApi.saveSettings(group, v!, q.data!.version),
    onSuccess: () => {
      toast.success(t('admin.settings.saved'))
      void qc.invalidateQueries({ queryKey: ['admin', 'settings', group] })
      // public site data (class name, palette, defaults) just changed
      void qc.invalidateQueries({ queryKey: siteKey })
      void qc.invalidateQueries({ queryKey: ['class'] })
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
    save.mutate()
  }
  const set = <F extends keyof SettingsGroupMap[K]>(f: F, val: SettingsGroupMap[K][F]) =>
    setV((s) => (s ? { ...s, [f]: val } : s))
  const str = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(f as keyof SettingsGroupMap[K], e.target.value as never)

  const val = v as unknown as Record<string, string | number | boolean> | null

  return (
    <QueryBoundary pending={q.isPending || !v} error={q.error} onRetry={() => void q.refetch()} rows={4}>
      {val && (
        <form className="form-stack" style={{ maxWidth: 520 }} onSubmit={submit} noValidate>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
            {group === 'site' && (
              <>
                <Field label={t('admin.settings.className')} hint={t('admin.settings.classNameNote')} error={fields.className}>
                  <Input value={String(val.className)} onChange={str('className')} invalid={!!fields.className} />
                </Field>
                <Field label={t('admin.settings.classNameEn')}>
                  <Input value={String(val.classNameEn)} onChange={str('classNameEn')} />
                </Field>
                <Field label={t('admin.settings.slogan')}>
                  <Input value={String(val.slogan)} onChange={str('slogan')} />
                </Field>
              </>
            )}
            {group === 'appearance' && (
              <>
                <Field label={t('admin.settings.quality')}>
                  <Select value={String(val.particleQualityDefault)} onChange={str('particleQualityDefault')}>
                    {(['high', 'medium', 'low', 'static'] as QualityTier[]).map((q2) => (
                      <option key={q2} value={q2}>
                        {t(`home.quality.${q2}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid-2">
                  <Field label={t('admin.settings.particleColor')}>
                    <Input type="color" value={String(val.particleColor)} onChange={str('particleColor')} style={{ padding: 4 }} />
                  </Field>
                  <Field label={t('admin.settings.accentColor')}>
                    <Input type="color" value={String(val.accentColor)} onChange={str('accentColor')} style={{ padding: 4 }} />
                  </Field>
                </div>
              </>
            )}
            {group === 'security' && (
              <>
                <Field label={t('admin.settings.registrationMode')}>
                  <Select value={String(val.registrationMode)} onChange={str('registrationMode')}>
                    <option value="invite">{t('admin.settings.regInvite')}</option>
                    <option value="closed">{t('admin.settings.regClosed')}</option>
                  </Select>
                </Field>
                <div className="grid-2">
                  <Field label={t('admin.settings.minPasswordLength')}>
                    <Input type="number" min={6} max={64} value={Number(val.minPasswordLength)} onChange={(e) => set('minPasswordLength' as keyof SettingsGroupMap[K], Number(e.target.value) as never)} />
                  </Field>
                  <Field label={t('admin.settings.sessionHours')}>
                    <Input type="number" min={1} max={720} value={Number(val.sessionHours)} onChange={(e) => set('sessionHours' as keyof SettingsGroupMap[K], Number(e.target.value) as never)} />
                  </Field>
                </div>
                <Switch
                  label={t('admin.settings.classInfoPublic')}
                  checked={Boolean(val.classInfoPublic)}
                  onChange={(e) => set('classInfoPublic' as keyof SettingsGroupMap[K], e.target.checked as never)}
                />
              </>
            )}
            {group === 'storage' && (
              <>
                <Field label={t('admin.settings.provider')}>
                  <Select value={String(val.provider)} onChange={str('provider')}>
                    <option value="local">Local disk</option>
                    <option value="s3">S3 / OSS</option>
                  </Select>
                </Field>
                <Field label={t('admin.settings.maxUploadMb')}>
                  <Input type="number" min={1} max={200} value={Number(val.maxUploadMb)} onChange={(e) => set('maxUploadMb' as keyof SettingsGroupMap[K], Number(e.target.value) as never)} />
                </Field>
              </>
            )}
          </fieldset>
          {!readOnly && (
            <div>
              <Button type="submit" variant="primary" loading={save.isPending}>
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          )}
        </form>
      )}
    </QueryBoundary>
  )
}

function SettingsAdmin() {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const readOnly = !can(user, 'site.settings.write')
  const [tab, setTab] = useState<SettingsGroupKey>('site')
  return (
    <div className="page">
      <PageHeader title={t('admin.settings.title')} />
      {readOnly && <p className="readonly-note">{t('admin.settings.readOnly')}</p>}
      <div className="tabs" role="tablist" aria-label={t('admin.settings.title')}>
        {TABS.map((g) => (
          <button key={g} role="tab" aria-selected={tab === g} onClick={() => setTab(g)}>
            {t(`admin.settings.${g}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <GroupForm key={tab} group={tab} readOnly={readOnly} />
      </div>
    </div>
  )
}

registerAdminModule({
  id: 'settings',
  group: 'site',
  order: 30,
  label: 'admin.nav.settings',
  icon: 'sliders',
  path: 'settings',
  permission: 'site.settings.read',
  element: SettingsAdmin,
})
