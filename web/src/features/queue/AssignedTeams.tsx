import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { speechApi, type PersonRef, type SpeechSessionDetail, type SpeechTeam } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Badge, Button, ConfirmDialog, Dialog, Field, Input, Pagination, toast } from '@/shared/ui'

export function AssignedTeams({ session, refresh }: { session: SpeechSessionDetail; refresh: () => void }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<SpeechTeam | 'new' | null>(null)
  const [removing, setRemoving] = useState<SpeechTeam | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => speechApi.disbandTeam(id),
    onSuccess: () => { setRemoving(null); refresh() },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const writable = session.allowTeams && session.status !== 'closed'
  return (
    <div className="teams">
      {writable && <Button size="sm" variant="secondary" icon="plus" onClick={() => setEditing('new')}>{t('queue.groups.create')}</Button>}
      {!session.allowTeams && <p className="muted small">{t('queue.teamsOff')}</p>}
      {session.teams.map((team) => (
        <div className="team" key={team.id}>
          <div className="team__head"><strong>{team.name}</strong>{team.assigned && <Badge>{t('queue.groups.assigned')}</Badge>}</div>
          <ul className="team__members">{team.members.map((member) => <li key={member.userId}>{member.displayName}{member.isLeader && <Badge>{t('queue.leader')}</Badge>}</li>)}</ul>
          {writable && <div className="row-actions"><Button size="sm" variant="ghost" onClick={() => setEditing(team)}>{t('queue.groups.edit')}</Button>
            {team.assigned && <Button size="sm" variant="ghost" onClick={() => setRemoving(team)}>{t('queue.groups.release')}</Button>}</div>}
        </div>
      ))}
      {editing && <TeamEditor session={session} team={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} refresh={refresh} />}
      <ConfirmDialog open={!!removing} title={t('queue.groups.release')} body={t('queue.groups.releaseHint')}
        loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} onClose={() => setRemoving(null)} />
    </div>
  )
}

function TeamEditor({ session, team, onClose, refresh }: { session: SpeechSessionDetail; team?: SpeechTeam; onClose: () => void; refresh: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(team?.name ?? '')
  const [chosen, setChosen] = useState<PersonRef[]>(() => team?.members.map((m) => ({ id: m.userId, displayName: m.displayName })) ?? [])
  const [leader, setLeader] = useState(team?.leaderId ?? '')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const candidates = useQuery({
    queryKey: ['speech', 'group-candidates', session.id, page, search],
    queryFn: () => speechApi.groupCandidates(session.id, { page, pageSize: 12, q: search }),
  })
  const save = useMutation({
    mutationFn: () => speechApi.assignTeam(session.id, { name: name.trim(), leaderId: leader, memberIds: chosen.map((x) => x.id), version: team?.version }, team?.id),
    onSuccess: () => { refresh(); onClose() },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = (id: string) => {
    setChosen((items) => items.filter((item) => item.id !== id))
    if (leader === id) setLeader('')
  }
  const unavailable = new Set(session.teams.filter((item) => item.id !== team?.id).flatMap((item) => item.members.map((member) => member.userId)))
  const valid = !!name.trim() && chosen.length >= 2 && chosen.some((item) => item.id === leader)
  return (
    <Dialog open title={t(team ? 'queue.groups.edit' : 'queue.groups.create')} onClose={onClose} footer={
      <Button type="submit" form="assigned-team-form" variant="primary" loading={save.isPending} disabled={!valid}>{t('common.save')}</Button>
    }>
      <form id="assigned-team-form" className="form-stack" onSubmit={(event) => { event.preventDefault(); if (valid && !save.isPending) save.mutate() }}>
        <Field label={t('queue.teamName')}><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></Field>
        <fieldset className="meeting-group-picker">
          <legend>{t('queue.groups.selected', { count: chosen.length, max: session.maxTeamSize })}</legend>
          {chosen.map((person) => (
            <div key={person.id} className="row-between">
              <label className="check"><input type="radio" name="team-leader" checked={leader === person.id} onChange={() => setLeader(person.id)} aria-label={t('queue.groups.chooseLeader', { name: person.displayName })} />{person.displayName}</label>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(person.id)}>{t('queue.groups.remove')}</Button>
            </div>
          ))}
        </fieldset>
        <Field label={t('queue.groups.search')}><Input value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></Field>
        {candidates.isPending && <p className="muted small">{t('common.loading')}</p>}
        {candidates.isError && <p role="alert">{errorMessage(candidates.error)}</p>}
        <div className="meeting-group-picker">
          {candidates.data?.items.map((person) => (
            <div key={person.id} className="row-between">
              <span>{person.displayName}</span>
              <Button type="button" size="sm" variant="ghost" disabled={unavailable.has(person.id) || chosen.length >= session.maxTeamSize || chosen.some((item) => item.id === person.id)} onClick={() => {
                setChosen([...chosen, person])
                if (!leader) setLeader(person.id)
              }}>{t('queue.groups.add')}</Button>
            </div>
          ))}
        </div>
        {candidates.data && candidates.data.total > 12 && <Pagination page={page} pageSize={12} total={candidates.data.total} onPage={setPage} />}
      </form>
    </Dialog>
  )
}
