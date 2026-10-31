import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { classApi } from '@/shared/api'
import { useDebounced, useDocumentTitle } from '@/shared/hooks'
import { errorMessage } from '@/shared/i18n'
import { useClassName, useSite } from '@/shared/site'
import { Input, Pagination, Skeleton, StateView } from '@/shared/ui'
import { ClassInfoView, MemberList, Timeline } from './ClassInfoView'
import './class-info.css'

export default function ClassPage() {
  const { t, i18n } = useTranslation()
  const site = useSite().data
  const name = useClassName(site)
  useDocumentTitle(`${t('info.title')} · ${name}`)
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 250)
  const [mPage, setMPage] = useState(1)
  const [tPage, setTPage] = useState(1)

  const members = useQuery({
    queryKey: ['class', 'members', i18n.language, dq, mPage],
    queryFn: () => classApi.members({ q: dq, page: mPage, pageSize: 24 }),
    placeholderData: keepPreviousData,
  })
  const timeline = useQuery({
    queryKey: ['class', 'timeline', i18n.language, tPage],
    queryFn: () => classApi.timeline({ page: tPage, pageSize: 10 }),
    placeholderData: keepPreviousData,
  })

  return (
    <PageShell back>
      <main className="class-page">
        <div className="class-page__bar">
          <Link to="/" className="btn btn-ghost btn-sm">
            ← {t('home.back')}
          </Link>
        </div>
        <ClassInfoView lists={false} />
        <div className="class-page__list">
          <section aria-labelledby="cp-members">
            <h3 id="cp-members" className="cinfo__h">
              {t('info.membersAll')}
            </h3>
            <div className="class-page__tools">
              <Input
                type="search"
                placeholder={t('admin.members.search')}
                aria-label={t('common.search')}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setMPage(1)
                }}
              />
            </div>
            {members.isPending ? (
              <Skeleton h={120} />
            ) : members.isError ? (
              <StateView icon="alert" title={t('common.error')} body={errorMessage(members.error)} />
            ) : members.data.items.length === 0 ? (
              <StateView icon="search" title={t('common.noResults')} />
            ) : (
              <>
                <MemberList members={members.data.items} />
                <Pagination page={mPage} pageSize={24} total={members.data.total} onPage={setMPage} />
              </>
            )}
          </section>
          <section aria-labelledby="cp-timeline">
            <h3 id="cp-timeline" className="cinfo__h">
              {t('info.timelineAll')}
            </h3>
            {timeline.isPending ? (
              <Skeleton h={160} />
            ) : timeline.isError ? (
              <StateView icon="alert" title={t('common.error')} body={errorMessage(timeline.error)} />
            ) : (
              <>
                <Timeline events={timeline.data.items} />
                <Pagination page={tPage} pageSize={10} total={timeline.data.total} onPage={setTPage} />
              </>
            )}
          </section>
        </div>
      </main>
    </PageShell>
  )
}
