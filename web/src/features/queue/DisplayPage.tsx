import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Spinner, StateView } from '@/shared/ui'
import { PptxSlides } from './CoursewarePreview'
import './preview.css'

export default function DisplayPage() {
  const { hash } = useLocation()
  const { t } = useTranslation()
  const params = new URLSearchParams(hash.slice(1))
  const url = params.get('url') ?? ''
  const mode = params.get('mode')
  const prefix = /^\/api\/v1\/speech\/preview\/[\w-]+\.[\w-]+\//
  const resource = url.replace(prefix, '')
  const valid = prefix.test(url) && (mode === 'web'
    ? /^site\/[\w.% -]+$/.test(resource)
    : (mode === 'pdf' || mode === 'pptx') && resource === 'file')
  const statusUrl = valid ? prefix.exec(url)![0] + 'status' : ''
  const display = useQuery({
    queryKey: ['speech', 'display', statusUrl],
    queryFn: async ({ signal }) => {
      const response = await fetch(statusUrl, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      return true
    },
    enabled: valid,
    retry: false,
    refetchInterval: (query) => query.state.status === 'error' ? false : 3000,
    refetchIntervalInBackground: true,
  })
  if (!valid || display.isError) return <StateView icon="alert" title={t('queue.display.ended')} />
  if (display.isPending) return <div className="pv__center"><Spinner label={t('preview.loading')} /></div>
  return (
    <main className="meeting-display">
      <h1>{t('queue.display.title')}</h1>
      {mode === 'pptx'
        ? <PptxSlides url={url} fallbackName={t('queue.display.title')} />
        : <iframe className="pv__frame" title={t('queue.display.title')} src={url} sandbox={mode === 'web' ? 'allow-scripts' : undefined} referrerPolicy="no-referrer" />}
    </main>
  )
}
