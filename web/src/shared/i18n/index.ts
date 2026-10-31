import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { api, isApiError } from '../api'
import { en } from './en'
import { zh } from './zh'

export type Lang = 'zh' | 'en'
const STORAGE_KEY = 'classight.lang'

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* noop */
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function initI18n() {
  const lng = detect()
  void i18n.use(initReactI18next).init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    lng,
    fallbackLng: 'zh',
    interpolation: { escapeValue: false },
  })
  apply(lng)
  return i18n
}

function apply(lng: Lang) {
  document.documentElement.lang = lng === 'zh' ? 'zh-CN' : 'en'
  api.setLanguage(lng)
}

export function setLanguage(lng: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* noop */
  }
  apply(lng)
  void i18n.changeLanguage(lng)
}

export const currentLang = (): Lang => (i18n.language === 'en' ? 'en' : 'zh')

/** Turn any thrown value into a user-facing sentence in the current language. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    const key = `errors.${e.code}`
    return i18n.exists(key) ? i18n.t(key) : i18n.t('errors.unknown')
  }
  return i18n.t('errors.unknown')
}

/** Field-level messages from ProblemDetails.errors, translated. */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (isApiError(e) && e.errors) {
    for (const [field, msgs] of Object.entries(e.errors)) {
      const m = msgs[0]
      if (!m) continue
      out[field] = i18n.exists(`errors.${m}`) ? i18n.t(`errors.${m}`) : m
    }
  }
  return out
}

export function formatDate(iso: string | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(currentLang() === 'zh' ? 'zh-CN' : 'en', opts).format(new Date(iso))
}

export { i18n }
