import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/shared/i18n'
import { pluginsApi, type CaptchaConfig } from '@/shared/plugins'
import { Button, Field, Input, Select, toast } from '@/shared/ui'
import { QueryBoundary } from '../common'

export function CaptchaSettings({ readOnly }: { readOnly: boolean }) {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'captcha'], queryFn: pluginsApi.captcha })
  const [config, setConfig] = useState<CaptchaConfig | null>(null)
  const [secret, setSecret] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (query.data) setConfig(query.data) }, [query.data])
  const save = useMutation({
    mutationFn: () => pluginsApi.saveCaptcha({ ...config!, secret, appSecret }),
    onSuccess: () => {
      setSecret(''); setAppSecret(''); setError('')
      void qc.invalidateQueries({ queryKey: ['admin', 'captcha'] })
      toast.success(en ? 'Settings saved' : '设置已保存')
    },
    onError: (issue) => setError(errorMessage(issue)),
  })
  const set = (name: keyof CaptchaConfig, value: string) => setConfig((current) => current ? { ...current, [name]: value } : current)
  const providerChanged = config?.provider !== query.data?.provider
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); save.mutate() }
  return (
    <QueryBoundary pending={query.isPending} error={query.error} onRetry={() => void query.refetch()} rows={4}>
      {config && <form className="admin-form captcha-settings" onSubmit={submit}>
        <p className="admin-form__note">{en ? 'Save the provider settings before enabling verification. Keep this administrator session open while checking them.' : '先保存服务商配置，再启用人机验证。核对配置期间请保留当前管理员会话。'}</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <fieldset disabled={readOnly || save.isPending} style={{ display: 'contents' }}>
          <section className="admin-form__section">
            <h3>{en ? 'Provider and site' : '服务商与站点'}</h3>
            <Field label={en ? 'Verification provider' : '验证服务'}>
              <Select value={config.provider} onChange={(event) => { set('provider', event.target.value); setSecret(''); setAppSecret(''); setError('') }}>
                <option value="cloudflare">Cloudflare Turnstile</option><option value="aliyun">阿里云 CAPTCHA 2.0</option><option value="tencent">腾讯云 CAPTCHA</option>
              </Select>
            </Field>
            <Field label={config.provider === 'cloudflare' ? 'Site key' : config.provider === 'aliyun' ? (en ? 'Instance prefix' : '实例前缀') : 'CaptchaAppId'}><Input value={config.siteKey} onChange={(event) => set('siteKey', event.target.value)} /></Field>
            {config.provider === 'aliyun' && <div className="grid-2">
              <Field label="Scene ID"><Input value={config.sceneId} onChange={(event) => set('sceneId', event.target.value)} /></Field>
              <Field label={en ? 'Region' : '地域'}><Select value={config.region} onChange={(event) => set('region', event.target.value)}><option value="cn">{en ? 'China' : '中国内地'}</option><option value="sgp">{en ? 'Singapore' : '新加坡'}</option></Select></Field>
            </div>}
          </section>
          <section className="admin-form__section">
            <h3>{en ? 'Credentials' : '验证凭据'}</h3>
            {config.provider !== 'cloudflare' && <Field label="Access key ID"><Input value={config.accessKeyId} onChange={(event) => set('accessKeyId', event.target.value)} /></Field>}
            <Field label={config.provider === 'cloudflare' ? 'Secret key' : 'Access key secret'} hint={!providerChanged && config.secretConfigured ? (en ? 'Leave empty to keep the saved secret.' : '留空则保留已保存的密钥。') : undefined}><Input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} /></Field>
            {config.provider === 'tencent' && <Field label="Captcha AppSecretKey" hint={!providerChanged && config.appSecretConfigured ? (en ? 'Leave empty to keep the saved secret.' : '留空则保留已保存的密钥。') : undefined}><Input type="password" autoComplete="new-password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} /></Field>}
          </section>
        </fieldset>
        {!readOnly && <div className="admin-form__actions"><Button variant="primary" type="submit" loading={save.isPending}>{en ? 'Save verification settings' : '保存验证配置'}</Button></div>}
      </form>}
    </QueryBoundary>
  )
}
