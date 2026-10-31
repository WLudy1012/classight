import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { CENTER_PATH, MEETINGS_PATH } from '@/features/class-center/paths'
import { speechApi } from '@/shared/api'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage, formatDate } from '@/shared/i18n'
import { Button, Icon, Pagination, Skeleton, StateView } from '@/shared/ui'
import { SessionDetail } from './SessionDetail'
import { sessionsKey, StatusBadge } from './shared'
import './queue.css'

export function QueueListPage() {
  const { t } = useTranslation()
  useDocumentTitle(t('queue.title'))
  const [page, setPage] = useState(1)
  const q = useQuery({
    queryKey: sessionsKey(page),
    queryFn: () => speechApi.sessions({ page, pageSize: 12 }),
    placeholderData: keepPreviousData,
    refetchInterval: () => (document.hidden ? false : 10_000),
  })

  return (
    <PageShell back>
      <main className="qpage">
        <div className="qpage__bar">
          <Link to={CENTER_PATH} className="btn btn-ghost btn-sm">
            <Icon name="arrowLeft" /> {t('center.title')}
          </Link>
        </div>
        <h1 className="page__title">{t('queue.sessions')}</h1>
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
      </main>
    </PageShell>
  )
}

export function QueueSessionPage() {
  const { sessionId = '' } = useParams()
  return (
    <PageShell back>
      <main className="qpage">
        <SessionDetail sessionId={sessionId} />
      </main>
    </PageShell>
  )
}
