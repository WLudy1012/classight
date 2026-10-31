import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { get } from '@/shared/api/client'
import { Button } from '@/shared/ui'

export type CaptchaProof = { token: string; randstr?: string }
type Config = { enabled: boolean; provider?: 'cloudflare' | 'aliyun' | 'tencent'; siteKey?: string; sceneId?: string; region?: string }
type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void }
type TencentInstance = { show: () => void }
type CaptchaWindow = Window & {
  turnstile?: Turnstile
  TencentCaptcha?: new (appId: string, callback: (result: { ret: number; ticket?: string; randstr?: string }) => void) => TencentInstance
  AliyunCaptchaConfig?: { region: string; prefix: string }
  initAliyunCaptcha?: (options: Record<string, unknown>) => void
}
const scripts = new Map<string, Promise<void>>()
function loadScript(src: string) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { scripts.delete(src); reject(new Error('captcha script unavailable')) }
    document.head.appendChild(script)
  }))
  return scripts.get(src)!
}

export function useCaptcha() {
  const query = useQuery({ queryKey: ['auth', 'captcha'], queryFn: () => get<Config>('/auth/captcha'), retry: false, staleTime: 30_000 })
  const [proof, setProof] = useState<CaptchaProof | undefined>()
  const [generation, setGeneration] = useState(0)
  const reset = () => { setProof(undefined); setGeneration((n) => n + 1) }
  return { config: query.data, pending: query.isPending, failed: query.isError, proof, setProof, generation, reset }
}

export function CaptchaWidget({ config, onProof }: { config: Config; onProof: (proof: CaptchaProof | undefined) => void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const uid = useId().replaceAll(':', '')
  const containerId = `captcha-${uid}`
  const buttonId = `captcha-button-${uid}`
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [verified, setVerified] = useState(false)
  const [open, setOpen] = useState<(() => void) | null>(null)
  useEffect(() => {
    let disposed = false
    let widgetId: string | undefined
    const w = window as CaptchaWindow
    const success = (token: string, randstr?: string) => { if (!disposed) { setFailed(false); setVerified(true); onProof({ token, randstr }) } }
    const fail = () => { if (!disposed) { setVerified(false); onProof(undefined); setFailed(true) } }
    async function init() {
      try {
        if (config.provider === 'cloudflare') {
          await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
          if (disposed) return
          const container = document.getElementById(containerId)
          if (!container || !w.turnstile) throw new Error('unavailable')
          widgetId = w.turnstile.render(container, { sitekey: config.siteKey, callback: (token: string) => success(token), 'expired-callback': fail, 'error-callback': fail })
        } else if (config.provider === 'tencent') {
          await loadScript('https://turing.captcha.qcloud.com/TJCaptcha.js')
          if (disposed) return
          if (!w.TencentCaptcha || !config.siteKey) throw new Error('unavailable')
          const instance = new w.TencentCaptcha(config.siteKey, (result) => { if (result.ret === 0 && result.ticket && result.randstr && !result.ticket.startsWith('trerror_')) success(result.ticket, result.randstr); else fail() })
          setOpen(() => () => instance.show())
        } else if (config.provider === 'aliyun') {
          w.AliyunCaptchaConfig = { region: config.region ?? 'cn', prefix: config.siteKey ?? '' }
          await loadScript('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js')
          if (disposed) return
          if (!w.initAliyunCaptcha) throw new Error('unavailable')
          w.initAliyunCaptcha({ SceneId: config.sceneId, mode: 'popup', element: `#${containerId}`, button: `#${buttonId}`, success: (token: string) => success(token), fail, getInstance: () => {} })
        } else throw new Error('unavailable')
        if (!disposed) setReady(true)
      } catch { fail() }
    }
    void init()
    return () => { disposed = true; if (widgetId && w.turnstile) w.turnstile.remove(widgetId) }
  }, [config, containerId, buttonId, onProof])
  return <div>
    <div id={containerId} />
    {config.provider === 'aliyun' && <button id={buttonId} type="button" className="btn btn-secondary" disabled={!ready}>{verified ? (zh ? '已完成验证' : 'Verified') : (zh ? '进行人机验证' : 'Verify you are human')}</button>}
    {config.provider === 'tencent' && <Button type="button" disabled={!ready || verified} onClick={() => open?.()}>{verified ? (zh ? '已完成验证' : 'Verified') : (zh ? '进行人机验证' : 'Verify you are human')}</Button>}
    {failed && <p className="form-error" role="alert">{zh ? '验证加载失败或已失效，请刷新页面重试。' : 'Verification failed or expired. Refresh the page and try again.'}</p>}
  </div>
}
