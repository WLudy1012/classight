import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/store'
import { speechApi } from '@/shared/api'
import { Icon } from '@/shared/ui'
import { MEETINGS_PATH } from '../paths'

export function MeetingDockEntry() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const signedIn = useAuth((state) => state.status === 'authenticated')
  const sessions = useQuery({ queryKey: ['speech', 'sessions', 'dock'], queryFn: () => speechApi.sessions({ pageSize: 6 }), enabled: signedIn, staleTime: 60_000, retry: false })
  const live = sessions.data?.items.find((item) => item.status === 'running') ?? sessions.data?.items.find((item) => item.status === 'open')
  return (
    <button className="dock__cell" data-magnet data-magnet-pad="4" data-magnet-radius="40" onClick={() => navigate(MEETINGS_PATH)}>
      <span className="dock__label"><Icon name="mic" size={15} /> {t('queue.title')}</span>
      <span className="dock__value num">{live ? `${live.title} · ${t(`queue.status.${live.status}`)}` : signedIn ? t('queue.noSessions') : t('home.login')}</span>
      <Icon name="arrowRight" size={16} className="dock__go" />
    </button>
  )
}
