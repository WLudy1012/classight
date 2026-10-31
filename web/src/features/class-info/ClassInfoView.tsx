import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { classApi, type MemberPublic, type TimelineEvent } from '@/shared/api'
import { formatDate, errorMessage } from '@/shared/i18n'
import { Avatar, Button, Skeleton, StateView } from '@/shared/ui'
import './class-info.css'

export const overviewKey = (lang: string) => ['class', 'overview', lang] as const

export function useClassOverview() {
  const { i18n } = useTranslation()
  return useQuery({
    queryKey: overviewKey(i18n.language),
    queryFn: ({ signal }) => classApi.overview(signal),
    staleTime: 60_000,
  })
}

export function MemberList({ members }: { members: MemberPublic[] }) {
  return (
    <ul className="members">
      {members.map((m) => (
        <li key={m.id} className="members__item">
          <Avatar name={m.displayName} src={m.avatarUrl} size={30} />
          <span className="members__name">{m.displayName}</span>
          {m.title && <span className="members__title">{m.title}</span>}
        </li>
      ))}
    </ul>
  )
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="tline">
      {events.map((ev) => (
        <li key={ev.id} className="tline__item">
          <time className="tline__date num" dateTime={ev.occurredOn}>
            {formatDate(ev.occurredOn, { year: 'numeric', month: 'short' })}
          </time>
          <div>
            <h4 className="tline__title">{ev.title}</h4>
            <p className="tline__summary">{ev.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function ClassInfoSkeleton() {
  return (
    <div className="cinfo" aria-busy="true">
      <Skeleton w="62%" h={34} />
      <Skeleton w="38%" h={14} style={{ marginTop: 14 }} />
      <Skeleton w="100%" h={14} style={{ marginTop: 28 }} />
      <Skeleton w="88%" h={14} style={{ marginTop: 10 }} />
      <Skeleton w="94%" h={14} style={{ marginTop: 10 }} />
    </div>
  )
}

/** The class story. Used inside the home sheet and on the /class page. */
export function ClassInfoView({ footer, lists = true }: { footer?: React.ReactNode; lists?: boolean }) {
  const { t } = useTranslation()
  const q = useClassOverview()

  if (q.isPending) return <ClassInfoSkeleton />
  if (q.isError)
    return (
      <StateView
        icon="alert"
        title={t('info.loadError')}
        body={errorMessage(q.error)}
        action={
          <Button size="sm" onClick={() => void q.refetch()}>
            {t('common.retry')}
          </Button>
        }
      />
    )

  const { profile, stats, membersPreview, latestTimeline } = q.data
  return (
    <div className="cinfo">
      <header className="cinfo__head">
        <h2 className="cinfo__motto">{profile.motto}</h2>
        <p className="cinfo__meta num">
          <span>{t('info.founded', { date: formatDate(profile.foundedOn, { year: 'numeric', month: 'long' }) })}</span>
          <span aria-hidden="true">·</span>
          <span>
            {stats.memberCount} {t('info.stats.members')}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {stats.timelineCount} {t('info.stats.events')}
          </span>
          {stats.foundedYears > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {stats.foundedYears} {t('info.stats.years')}
              </span>
            </>
          )}
        </p>
      </header>

      <p className="cinfo__intro">{profile.intro}</p>

      {lists && (
      <div className="cinfo__cols">
        <section aria-labelledby="ci-members">
          <h3 id="ci-members" className="cinfo__h">
            {t('info.members')}
          </h3>
          <MemberList members={membersPreview} />
        </section>
        <section aria-labelledby="ci-timeline">
          <h3 id="ci-timeline" className="cinfo__h">
            {t('info.timeline')}
          </h3>
          <Timeline events={latestTimeline} />
        </section>
      </div>
      )}

      <footer className="cinfo__foot">
        <span className="cinfo__note">{t('info.synthetic')}</span>
        {footer}
      </footer>
    </div>
  )
}
