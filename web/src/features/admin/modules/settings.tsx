import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { adminApi, type QualityTier, type SettingsGroupKey, type SettingsGroupMap } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { errorMessage, fieldErrors } from '@/shared/i18n'
import { siteKey } from '@/shared/site'
import { Button, Field, Input, Select, Switch, Tabs, TabPanel, useTabsId, toast } from '@/shared/ui'
import { PageHeader, QueryBoundary } from '../common'
import { registerAdminModule } from '../registry'

const SECTIONS = ['site', 'appearance', 'security', 'storage'] as const

function GroupForm<K extends SettingsGroupKey>({ group, readOnly }: { group: K; readOnly: boolean }) {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'settings', group], queryFn: () => adminApi.settingsGroup(group) })
  const [values, setValues] = useState<SettingsGroupMap[K] | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  useEffect(() => { if (query.data) setValues(query.data.values) }, [query.data])
  const save = useMutation({
    mutationFn: () => adminApi.saveSettings(group, values!, query.data!.version),
    onSuccess: () => {
      toast.success(t('admin.settings.saved'))
      void qc.invalidateQueries({ queryKey: ['admin', 'settings', group] })
      void qc.invalidateQueries({ queryKey: siteKey })
      void qc.invalidateQueries({ queryKey: ['class'] })
    },
    onError: (issue) => { setError(errorMessage(issue)); setFields(fieldErrors(issue)) },
  })
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); setFields({}); save.mutate() }
  const set = <F extends keyof SettingsGroupMap[K]>(field: F, value: SettingsGroupMap[K][F]) => setValues((current) => current ? { ...current, [field]: value } : current)
  const str = (field: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(field as keyof SettingsGroupMap[K], event.target.value as never)
  const val = values as unknown as Record<string, string | number | boolean> | null

  return (
    <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()} rows={4}>
      {val && (
        <form className="admin-form" onSubmit={submit} noValidate>
          {error && <div className="form-error" role="alert">{error}</div>}
          <fieldset disabled={readOnly || save.isPending} style={{ display: 'contents' }}>
            {group === 'site' && (
              <section className="admin-form__section">
                <h3>{en ? 'Site identity' : '站点身份'}</h3>
                <div className="grid-2">
                  <Field label={t('admin.settings.className')} hint={t('admin.settings.classNameNote')} error={fields.className}>
                    <Input value={String(val.className ?? '')} onChange={str('className')} invalid={!!fields.className} />
                  </Field>
                  <Field label={t('admin.settings.classNameEn')}>
                    <Input value={String(val.classNameEn ?? '')} onChange={str('classNameEn')} />
                  </Field>
                </div>
                <Field label={t('admin.settings.slogan')}><Input value={String(val.slogan ?? '')} onChange={str('slogan')} /></Field>
              </section>
            )}
            {group === 'appearance' && (
              <>
                <section className="admin-form__section">
                  <h3>{en ? 'Home experience' : '首页表现'}</h3>
                  <Field label={t('admin.settings.quality')}>
                    <Select value={String(val.particleQualityDefault)} onChange={str('particleQualityDefault')}>
                      {(['high', 'medium', 'low', 'static'] as QualityTier[]).map((quality) => <option key={quality} value={quality}>{t(`home.quality.${quality}`)}</option>)}
                    </Select>
                  </Field>
                </section>
                <section className="admin-form__section">
                  <h3>{en ? 'Colors' : '颜色'}</h3>
                  <div className="grid-2">
                    <Field label={t('admin.settings.particleColor')}><Input type="color" value={String(val.particleColor)} onChange={str('particleColor')} style={{ padding: 4 }} /></Field>
                    <Field label={t('admin.settings.accentColor')}><Input type="color" value={String(val.accentColor)} onChange={str('accentColor')} style={{ padding: 4 }} /></Field>
                  </div>
                </section>
              </>
            )}
            {group === 'security' && (
              <>
                <section className="admin-form__section">
                  <h3>{en ? 'Access to the site' : '站点访问'}</h3>
                  <Field label={t('admin.settings.registrationMode')}>
                    <Select value={String(val.registrationMode)} onChange={str('registrationMode')}>
                      <option value="invite">{t('admin.settings.regInvite')}</option><option value="closed">{t('admin.settings.regClosed')}</option>
                    </Select>
                  </Field>
                  <Switch label={t('admin.settings.classInfoPublic')} checked={Boolean(val.classInfoPublic)} onChange={(event) => set('classInfoPublic' as keyof SettingsGroupMap[K], event.target.checked as never)} />
                </section>
                <section className="admin-form__section">
                  <h3>{en ? 'Passwords and sessions' : '密码与登录会话'}</h3>
                  <div className="grid-2">
                    <Field label={t('admin.settings.minPasswordLength')}><Input type="number" min={6} max={64} value={Number(val.minPasswordLength)} onChange={(event) => set('minPasswordLength' as keyof SettingsGroupMap[K], Number(event.target.value) as never)} /></Field>
                    <Field label={t('admin.settings.sessionHours')}><Input type="number" min={1} max={720} value={Number(val.sessionHours)} onChange={(event) => set('sessionHours' as keyof SettingsGroupMap[K], Number(event.target.value) as never)} /></Field>
                  </div>
                  <p className="admin-form__note">{en ? 'Human verification is configured in ' : '登录和注册的人机验证统一在'}<Link to="/admin/plugins?config=captcha">{en ? 'Plugins' : '插件管理'}</Link>{en ? '.' : '中配置。'}</p>
                </section>
              </>
            )}
            {group === 'storage' && (
              <section className="admin-form__section">
                <h3>{en ? 'Uploaded files' : '上传文件'}</h3>
                <Field label={t('admin.settings.provider')}><Select value={String(val.provider)} onChange={str('provider')}><option value="local">{en ? 'Local disk' : '本地磁盘'}</option><option value="s3">S3 / OSS</option></Select></Field>
                <Field label={t('admin.settings.maxUploadMb')}><Input type="number" min={1} max={200} value={Number(val.maxUploadMb)} onChange={(event) => set('maxUploadMb' as keyof SettingsGroupMap[K], Number(event.target.value) as never)} /></Field>
              </section>
            )}
          </fieldset>
          {!readOnly && <div className="admin-form__actions"><Button type="submit" variant="primary" loading={save.isPending}>{save.isPending ? t('common.saving') : t('common.save')}</Button></div>}
        </form>
      )}
    </QueryBoundary>
  )
}

function SettingsAdmin() {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const readOnly = !can(useAuth((state) => state.user), 'site.settings.write')
  const [params, setParams] = useSearchParams()
  const selected = params.get('section')
  const section = SECTIONS.find((item) => item === selected) ?? 'site'
  const id = useTabsId()
  const descriptions = {
    site: en ? 'The name and message shown throughout your class website.' : '统一设置全站显示的班级名称和口号。',
    appearance: en ? 'Choose how the interactive homepage looks and performs.' : '调整交互首页的视觉与粒子表现。',
    security: en ? 'Control registration, public access and account protection.' : '管理注册方式、公开内容和账号保护。',
    storage: en ? 'Set where uploads are stored and how large they can be.' : '设置上传文件的存储方式和大小限制。',
  }
  const select = (value: typeof section) => { const next = new URLSearchParams(params); next.set('section', value); setParams(next) }
  return (
    <div className="page admin-settings">
      <PageHeader title={t('admin.settings.title')} sub={en ? 'Site-wide choices, organized by purpose.' : '按用途集中管理站点设置。'} />
      {readOnly && <p className="readonly-note">{t('admin.settings.readOnly')}</p>}
      <Tabs tabs={SECTIONS.map((key) => ({ key, label: t(`admin.settings.${key}`) }))} value={section} onChange={select} idBase={id} label={t('admin.settings.title')} />
      <TabPanel idBase={id} tabKey={section} value={section}>
        <div className="admin-settings__panel">
          <p className="admin-settings__intro">{descriptions[section]}</p>
          <GroupForm key={section} group={section} readOnly={readOnly} />
        </div>
      </TabPanel>
    </div>
  )
}

registerAdminModule({ id: 'settings', group: 'site', order: 30, label: 'admin.nav.settings', icon: 'sliders', path: 'settings', permission: 'site.settings.read', element: SettingsAdmin })
