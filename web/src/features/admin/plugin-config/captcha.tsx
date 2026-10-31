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
  const q = useQuery({ queryKey: ['admin', 'captcha'], queryFn: pluginsApi.captcha })
  const [config, setConfig] = useState<CaptchaConfig | null>(null)
  const [secret, setSecret] = useState('')
  const [appSecret, setAppSecret] = useState('')
  useEffect(() => { if (q.data) setConfig(q.data) }, [q.data])
  const save = useMutation({ mutationFn: () => pluginsApi.saveCaptcha({ ...config!, secret, appSecret }), onSuccess: () => { setSecret(''); setAppSecret(''); void qc.invalidateQueries({ queryKey: ['admin', 'captcha'] }); toast.success(en ? 'Settings saved' : '设置已保存') }, onError: (e) => toast.error(errorMessage(e)) })
  const set = (name: keyof CaptchaConfig, value: string) => setConfig((old) => old ? { ...old, [name]: value } : old)
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  return <QueryBoundary pending={q.isPending} error={q.error} onRetry={() => void q.refetch()} rows={4}>
    {config && <form className="form-stack" style={{ maxWidth: 520, marginTop: 24 }} onSubmit={submit}>
      <p className="muted small">{en ? 'Before enabling, keep this administrator session open and verify the provider domain and keys. Invalid credentials can block sign-in.' : '启用前请保留当前管理员会话，并核对服务商域名和密钥。凭据无效可能导致无法登录。'}</p>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'contents' }}>
        <Field label={en ? 'Provider' : '验证服务'}><Select value={config.provider} onChange={(e) => set('provider', e.target.value)}><option value="cloudflare">Cloudflare Turnstile</option><option value="aliyun">阿里云 CAPTCHA 2.0</option><option value="tencent">腾讯云 CAPTCHA</option></Select></Field>
        <Field label={config.provider === 'cloudflare' ? 'Site key' : config.provider === 'aliyun' ? 'Instance ID / prefix' : 'CaptchaAppId'}><Input value={config.siteKey} onChange={(e) => set('siteKey', e.target.value)} /></Field>
        {config.provider === 'aliyun' && <><Field label="Scene ID"><Input value={config.sceneId} onChange={(e) => set('sceneId', e.target.value)} /></Field><Field label={en ? 'Region' : '地域'}><Select value={config.region} onChange={(e) => set('region', e.target.value)}><option value="cn">China</option><option value="sgp">Singapore</option></Select></Field></>}
        {config.provider !== 'cloudflare' && <Field label="Access key ID"><Input value={config.accessKeyId} onChange={(e) => set('accessKeyId', e.target.value)} /></Field>}
        <Field label={config.provider === 'cloudflare' ? 'Secret key' : 'Access key secret'} hint={config.secretConfigured ? (en ? 'Leave empty to keep the saved secret.' : '留空则保留已保存的密钥。') : undefined}><Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
        {config.provider === 'tencent' && <Field label="Captcha AppSecretKey" hint={config.appSecretConfigured ? (en ? 'Leave empty to keep the saved secret.' : '留空则保留已保存的密钥。') : undefined}><Input type="password" autoComplete="new-password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} /></Field>}
      </fieldset>
      {!readOnly && <div><Button variant="primary" type="submit" loading={save.isPending}>{en ? 'Save' : '保存'}</Button></div>}
    </form>}
  </QueryBoundary>
}

