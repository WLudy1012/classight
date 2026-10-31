import { MEETINGS_PATH } from '@/features/class-center/paths'
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { speechApi, type SpeechEntry, type SpeechSessionDetail, type SpeechTeam } from '@/shared/api'
import { can, useAuth } from '@/features/auth/store'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage, fieldErrors, formatDate } from '@/shared/i18n'
import { Avatar, Badge, Button, ConfirmDialog, Dialog, Field, Icon, Input, Skeleton, StateView, toast } from '@/shared/ui'
import { CoursewarePanel } from './CoursewarePanel'
import { sessionKey, StatusBadge } from './shared'

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const user = useAuth((s) => s.user)
  const canJoin = can(user, 'speech.participate')
  const manage = can(user, 'speech.manage')

  const q = useQuery({
    queryKey: sessionKey(sessionId),
    queryFn: ({ signal }) => speechApi.session(sessionId, signal),
    // polling instead of a socket: cheap, and paused while the tab is hidden
    refetchInterval: () => (document.hidden ? false : 5000),
  })
  const caps = useQuery({ queryKey: ['speech', 'capabilities'], queryFn: speechApi.capabilities, staleTime: 5 * 60_000 })
  useDocumentTitle(q.data ? `${q.data.title} · ${t('queue.title')}` : t('queue.title'))
  const refresh = () => void qc.invalidateQueries({ queryKey: sessionKey(sessionId) })

  const [signing, setSigning] = useState(false)
  const [dropping, setDropping] = useState<SpeechEntry | null>(null)

  const drop = useMutation({
    mutationFn: (id: string) => speechApi.deleteEntry(id),
    onSuccess: () => {
      setDropping(null)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (q.isPending)
    return (
      <div className="stack-sm">
        <Skeleton w={280} h={34} />
        <Skeleton h={120} />
        <Skeleton h={220} />
      </div>
    )
  if (q.isError)
    return (
      <StateView
        icon="alert"
        title={t('common.error')}
        body={errorMessage(q.error)}
        action={
          <Button onClick={() => void q.refetch()}>{t('common.retry')}</Button>
        }
      />
    )

  const s = q.data
  const speaking = s.entries.find((e) => e.status === 'speaking')
  const waiting = s.entries.filter((e) => e.status === 'queued')
  const mine = s.entries.find((e) => e.mine)
  const open = (s.status === 'open' || s.status === 'running') && s.submissionsOpen
  const myTeam = s.teams.find((x) => x.mine)

  return (
    <div className="qdetail">
      <div className="qpage__bar">
        <Link to={MEETINGS_PATH} className="btn btn-ghost btn-sm">
          <Icon name="arrowLeft" /> {t('queue.back')}
        </Link>
        <span className="muted small">{t('queue.pollHint')}</span>
      </div>

      <header className="qhead">
        <div>
          <h1 className="page__title">{s.title}</h1>
          <p className="qhead__meta num">
            {formatDate(s.date, { dateStyle: 'long' })} · {t('queue.slotMinutes', { n: s.slotMinutes })} · {t('queue.entries', { count: s.entryCount })}
          </p>
          {s.description && <p className="qhead__desc">{s.description}</p>}
        </div>
        <div className="qhead__side">
          <StatusBadge status={s.status} />
          {canJoin && !mine && (
            <Button variant="primary" icon="mic" disabled={!open} onClick={() => setSigning(true)}>
              {t('queue.signUp')}
            </Button>
          )}
          {!open && !mine && canJoin && <span className="muted small">{t('queue.closedNote')}</span>}
        </div>
      </header>

      <section className="qnow" aria-label={t('queue.now')} data-live={!!speaking || undefined}>
        <span className="qnow__label">{speaking ? t('queue.now') : t('queue.next')}</span>
        {speaking ? (
          <EntryHead entry={speaking} />
        ) : waiting[0] ? (
          <EntryHead entry={waiting[0]} />
        ) : (
          <span className="muted">{t('queue.nowNone')}</span>
        )}
      </section>

      <div className="qgrid">
        <section aria-labelledby="q-order" className="qgrid__main">
          <h2 id="q-order" className="page__h">
            {t('queue.queueTitle')}
          </h2>
          {s.entries.length === 0 ? (
            <StateView icon="mic" title={t('queue.nobodyYet')} body={t('queue.nobodyYetBody')} />
          ) : (
            <ol className="qlistx">
              {s.entries.map((e) => (
                <li key={e.id} className="qitem" data-status={e.status} data-mine={e.mine || undefined}>
                  <span className="qitem__pos num">{e.position}</span>
                  <div className="qitem__body">
                    <EntryHead entry={e} compact />
                    <div className="qitem__tools">
                      <Badge tone={e.status === 'speaking' ? 'solid' : e.status === 'done' ? 'success' : undefined}>{t(`queue.entry.${e.status}`)}</Badge>
                      {e.mine && <Badge tone="solid">{t('queue.mine')}</Badge>}
                      {(e.mine || manage) && (e.status === 'queued' || manage) && (
                        <Button size="sm" variant="ghost" onClick={() => setDropping(e)}>
                          {t('queue.cancelEntry')}
                        </Button>
                      )}
                    </div>
                    {(e.mine || manage || e.courseware) && (
                      <CoursewarePanel
                        entry={e}
                        canEdit={(e.mine || manage || !!(myTeam && e.team?.id === myTeam.id)) && (canJoin || manage) && (e.status === 'queued' || e.status === 'speaking' || manage)}
                        caps={caps.data}
                        invalidate={refresh}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="qgrid__side" aria-labelledby="q-teams">
          <h2 id="q-teams" className="page__h">
            {t('queue.teams')}
          </h2>
          <TeamsPanel session={s} canJoin={canJoin} refresh={refresh} />
        </aside>
      </div>

      {signing && <SignUpDialog session={s} onClose={() => setSigning(false)} refresh={refresh} />}
      <ConfirmDialog
        open={!!dropping}
        danger
        title={t('queue.cancelEntryTitle')}
        body={dropping && t('queue.cancelEntryBody', { name: dropping.topic })}
        confirmLabel={t('queue.cancelEntry')}
        loading={drop.isPending}
        onConfirm={() => dropping && drop.mutate(dropping.id)}
        onClose={() => setDropping(null)}
      />
    </div>
  )
}

function EntryHead({ entry, compact }: { entry: SpeechEntry; compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="ehead" data-compact={compact || undefined}>
      <div className="ehead__avatars">
        {(entry.team?.members ?? [{ userId: entry.owner.id, displayName: entry.owner.displayName, avatarUrl: entry.owner.avatarUrl, isLeader: true }]).slice(0, 4).map((m) => (
          <Avatar key={m.userId} name={m.displayName} src={m.avatarUrl} size={compact ? 28 : 36} />
        ))}
      </div>
      <div className="ehead__text">
        <span className="ehead__topic">{entry.topic}</span>
        <span className="ehead__who">
          {entry.team ? `${t('queue.teamLabel')} ${entry.team.name} · ${entry.team.members.map((m) => m.displayName).join('、')}` : entry.owner.displayName}
        </span>
      </div>
    </div>
  )
}

function TeamsPanel({ session, canJoin, refresh }: { session: SpeechSessionDetail; canJoin: boolean; refresh: () => void }) {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const manage = can(user, 'speech.manage')
  const mine = session.teams.find((x) => x.mine)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [disband, setDisband] = useState<SpeechTeam | null>(null)
  const done = (msg: string) => {
    toast.success(msg)
    setName('')
    setCode('')
    setError('')
    refresh()
  }
  const create = useMutation({ mutationFn: () => speechApi.createTeam(session.id, { name: name.trim() }), onSuccess: () => done(t('queue.teamCreated')), onError: (e) => setError(errorMessage(e)) })
  const join = useMutation({ mutationFn: () => speechApi.joinTeam({ code: code.trim() }), onSuccess: () => done(t('queue.teamJoined')), onError: (e) => setError(errorMessage(e)) })
  const remove = useMutation({
    mutationFn: ({ team, userId }: { team: string; userId: string }) => speechApi.removeMember(team, userId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: (id: string) => speechApi.disbandTeam(id),
    onSuccess: () => {
      setDisband(null)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (!session.allowTeams) return <p className="muted small">{t('queue.teamsOff')}</p>

  return (
    <div className="teams">
      {mine && (
        <div className="team">
          <div className="team__head">
            <strong>{mine.name}</strong>
            <span className="muted small num">{t('queue.members', { count: mine.members.length, max: session.maxTeamSize })}</span>
          </div>
          <ul className="team__members">
            {mine.members.map((m) => (
              <li key={m.userId}>
                <Avatar name={m.displayName} src={m.avatarUrl} size={26} />
                <span>{m.displayName}</span>
                {m.isLeader && <Badge>{t('queue.leader')}</Badge>}
                {(mine.leaderId === user?.id || manage || m.userId === user?.id) && !m.isLeader && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate({ team: mine.id, userId: m.userId })}>
                    {m.userId === user?.id ? t('queue.leave') : t('queue.kick')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {mine.joinCode && (
            <div className="secret">
              <code aria-label={t('queue.joinCode')}>{mine.joinCode}</code>
              <Button size="sm" icon="copy" onClick={() => void navigator.clipboard?.writeText(mine.joinCode!).then(() => toast.info(t('common.copied')))}>
                {t('queue.joinCodeCopy')}
              </Button>
            </div>
          )}
          {(mine.leaderId === user?.id || manage) && (
            <Button size="sm" variant="danger" onClick={() => setDisband(mine)}>
              {t('queue.disband')}
            </Button>
          )}
        </div>
      )}

      {!mine && canJoin && (
        <div className="stack-sm">
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <form
            className="form-stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              create.mutate()
            }}
          >
            <Field label={t('queue.createTeam')}>
              <div className="inline-form">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('queue.teamName')} maxLength={60} />
                <Button type="submit" variant="secondary" loading={create.isPending} disabled={!name.trim()}>
                  {t('common.create')}
                </Button>
              </div>
            </Field>
          </form>
          <form
            className="form-stack"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              setError('')
              join.mutate()
            }}
          >
            <Field label={t('queue.joinTeam')} hint={t('queue.joinCodeHint')}>
              <div className="inline-form">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('queue.joinCode')} autoComplete="off" />
                <Button type="submit" variant="secondary" loading={join.isPending} disabled={!code.trim()}>
                  {t('queue.joinTeam')}
                </Button>
              </div>
            </Field>
          </form>
        </div>
      )}
      {!mine && !canJoin && <p className="muted small">{t('queue.noTeam')}</p>}

      <ConfirmDialog
        open={!!disband}
        danger
        title={t('queue.disbandTitle')}
        body={disband && t('queue.disbandBody', { name: disband.name })}
        confirmLabel={t('queue.disband')}
        loading={del.isPending}
        onConfirm={() => disband && del.mutate(disband.id)}
        onClose={() => setDisband(null)}
      />
    </div>
  )
}

function SignUpDialog({ session, onClose, refresh }: { session: SpeechSessionDetail; onClose: () => void; refresh: () => void }) {
  const { t } = useTranslation()
  const user = useAuth((s) => s.user)
  const myTeam = session.teams.find((x) => x.mine && x.leaderId === user?.id && !x.entryId)
  const [topic, setTopic] = useState('')
  const [asTeam, setAsTeam] = useState(!!myTeam)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const m = useMutation({
    mutationFn: () => speechApi.signUp(session.id, { topic: topic.trim(), teamId: asTeam ? myTeam?.id : undefined }),
    onSuccess: () => {
      toast.success(t('queue.signUpDone'))
      refresh()
      onClose()
    },
    onError: (e) => {
      setError(errorMessage(e))
      setFields(fieldErrors(e))
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('queue.signUpTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="signup-form" loading={m.isPending} disabled={!topic.trim()}>
            {t('queue.signUp')}
          </Button>
        </>
      }
    >
      <form
        id="signup-form"
        className="form-stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError('')
          setFields({})
          m.mutate()
        }}
        noValidate
      >
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Field label={t('queue.topic')} hint={t('queue.topicHint')} error={fields.topic}>
          <Input autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} invalid={!!fields.topic} />
        </Field>
        {myTeam && (
          <fieldset className="choice">
            <label className="check">
              <input type="radio" name="who" checked={!asTeam} onChange={() => setAsTeam(false)} />
              <span>{t('queue.asSolo')}</span>
            </label>
            <label className="check">
              <input type="radio" name="who" checked={asTeam} onChange={() => setAsTeam(true)} />
              <span>
                {t('queue.asTeam')}：{myTeam.name}
              </span>
            </label>
          </fieldset>
        )}
      </form>
    </Dialog>
  )
}
