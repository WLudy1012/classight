import { useTranslation } from 'react-i18next'
import type { SpeechSession } from '@/shared/api'
import { Badge } from '@/shared/ui'

export const sessionsKey = (page: number) => ['speech', 'sessions', page] as const
export const sessionKey = (id: string) => ['speech', 'session', id] as const

export function StatusBadge({ status }: { status: SpeechSession['status'] }) {
  const { t } = useTranslation()
  return <Badge tone={status === 'running' ? 'solid' : status === 'open' ? 'success' : undefined}>{t(`queue.status.${status}`)}</Badge>
}
