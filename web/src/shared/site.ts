import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { siteApi, type SitePublic } from '@/shared/api'

export const siteKey = ['site', 'public'] as const

export function useSite() {
  return useQuery({ queryKey: siteKey, queryFn: siteApi.public, staleTime: 5 * 60_000 })
}

/** Class name in the active interface language, falling back sensibly. */
export function useClassName(site?: SitePublic): string {
  const { i18n } = useTranslation()
  if (!site) return 'Classight'
  return i18n.language === 'en' ? site.classNameEn || site.className : site.className
}
