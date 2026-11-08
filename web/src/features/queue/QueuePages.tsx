import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MEETINGS_PATH } from '@/features/class-center/paths'
import { speechApi } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Button, Icon, Pagination, Skeleton, StateView } from '@/shared/ui'
import { SessionDetail } from './SessionDetail'
import { sessionsKey, StatusBadge } from './shared'
import { SessionEditor } from './SessionEditor'
import './queue.css'

export function QueueListPage() {
  const { t, i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const manage = can(useAuth((state) => state.user), 'speech.manage')
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  useDocumentTitle(t('queue.title'))
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: [...sessionsKey(page), manage ? 'manage' : 'member'],
    queryFn: () => manage ? speechApi.adminSessions({ page, pageSize: 12 }) : speechApi.sessions({ page, pageSize: 12 }),
    placeholderData: keepPreviousData,
    refetchInterval: () => (document.hidden ? false : 10_000),
  })

  return (
      <div className="qpage page">
        <div className="row-between"><div><h1 className="page__title">{t('queue.sessions')}</h1>{manage && <p className="page__sub">{en ? 'Create meetings, open registration and manage the presentation queue.' : '创建班会、开放报名，并管理发言与课件。'}</p>}</div>{manage && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>{en ? 'Create meeting' : '新建班会'}</Button>}</div>
        <div className="qlist">
          {q.isPending && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={72} />)}
          {q.isError && (
            <StateView icon="alert" title={t('common.error')} body={errorMessage(q.error)} action={<Button onClick={() => void q.refetch()}>{t('common.retry')}</Button>} />
          )}
          {q.data && q.data.items.length === 0 && <StateView icon="mic" title={t('queue.noSessions')} body={t('queue.noSessionsBody')} />}
          {q.data?.items.map((s) => (
            <Link key={s.id} to={`${MEETINGS_PATH}/${s.id}`} className="qrow">
              <span className="qrow__date num">
                <b>{formatDate(s.date, { day: 'numeric' })}</b>
                {formatDate(s.date, { month: 'short' })}
              </span>
              <span className="qrow__main">
                <span className="qrow__title">{s.title}</span>
                <span className="qrow__sub">
                  {t('queue.entries', { count: s.entryCount })} · {t('queue.slotMinutes', { n: s.slotMinutes })}
                </span>
              </span>
              <StatusBadge status={s.status} />
              <Icon name="arrowRight" size={16} />
            </Link>
          ))}
        </div>
        {q.data && q.data.total > 12 && <Pagination page={page} pageSize={12} total={q.data.total} onPage={setPage} />}
        {creating && <SessionEditor onClose={() => setCreating(false)} onSaved={(session) => navigate(`${MEETINGS_PATH}/${session.id}`)} />}
      </div>
  )
}

export function QueueSessionPage() {
  const { sessionId = '' } = useParams()
  return (
      <div className="qpage page">
        <SessionDetail sessionId={sessionId} />
      </div>
  )
}
