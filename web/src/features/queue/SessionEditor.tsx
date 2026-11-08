import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { speechApi, type SpeechSession } from '@/shared/api'
import { errorMessage } from '@/shared/i18n'
import { Button, Dialog, Field, Input, Switch, Textarea } from '@/shared/ui'

export function SessionEditor({ session, onClose, onSaved }: { session?: SpeechSession; onClose: () => void; onSaved?: (session: SpeechSession) => void }) {
  const en = useTranslation().i18n.language.startsWith('en')
  const text = (zh: string, english: string) => en ? english : zh
  const qc = useQueryClient()
  const [form, setForm] = useState({ title: session?.title ?? '', date: session?.date ?? new Date().toLocaleDateString('sv-SE'), description: session?.description ?? '', slotMinutes: session?.slotMinutes ?? 5, allowTeams: session?.allowTeams ?? true, maxTeamSize: session?.maxTeamSize ?? 4, submissionsOpen: session?.submissionsOpen ?? true })
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => session ? speechApi.updateSession(session.id, { ...form, title: form.title.trim(), version: session.version }) : speechApi.createSession({ ...form, title: form.title.trim() }),
    onSuccess: (result) => { void qc.invalidateQueries({ queryKey: ['speech'] }); onSaved?.(result); onClose() },
    onError: (value) => setError(errorMessage(value)),
  })
  const submit = (event: FormEvent) => { event.preventDefault(); setError(''); save.mutate() }
  return <Dialog open onClose={onClose} title={session ? text('编辑班会', 'Edit meeting') : text('新建班会', 'Create meeting')} footer={<><Button variant="ghost" onClick={onClose}>{text('取消', 'Cancel')}</Button><Button form="meeting-editor" type="submit" variant="primary" loading={save.isPending} disabled={!form.title.trim() || !form.date}>{text('保存', 'Save')}</Button></>}>
    <form id="meeting-editor" className="form-stack" onSubmit={submit}>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Field label={text('班会名称', 'Meeting title')}><Input required autoFocus maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label={text('日期', 'Date')}><Input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
      <Field label={text('说明', 'Description')}><Textarea rows={3} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
      <div className="grid-2"><Field label={text('每组分钟数', 'Minutes per entry')}><Input type="number" min={1} max={60} value={form.slotMinutes} onChange={(event) => setForm({ ...form, slotMinutes: Number(event.target.value) })} /></Field><Field label={text('每队人数上限', 'Maximum team size')}><Input type="number" min={2} max={20} disabled={!form.allowTeams} value={form.maxTeamSize} onChange={(event) => setForm({ ...form, maxTeamSize: Number(event.target.value) })} /></Field></div>
      <Switch checked={form.allowTeams} onChange={(event) => setForm({ ...form, allowTeams: event.target.checked })} label={text('允许组队', 'Allow teams')} />
      {session && <Switch checked={form.submissionsOpen} onChange={(event) => setForm({ ...form, submissionsOpen: event.target.checked })} label={text('开放报名', 'Accept submissions')} />}
      {!session && <p className="muted small">{text('新班会先保存为草稿，进入场次后开放报名。', 'New meetings start as drafts. Open registration from the meeting page.')}</p>}
    </form>
  </Dialog>
}
