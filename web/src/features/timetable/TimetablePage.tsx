import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageShell } from '@/app/PageShell'
import { can, useAuth } from '@/features/auth/store'
import { get, put } from '@/shared/api/client'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage } from '@/shared/i18n'
import { Button, Field, Icon, Input, Select, Skeleton, StateView, toast } from '@/shared/ui'
import { activeLesson, dateString, validateTimetable, type Lesson, type Timetable } from './model'
import './timetable.css'

const newLesson = (totalWeeks: number): Lesson => ({ id: crypto.randomUUID(), name: '', teacher: '', room: '', day: 1, startPeriod: 1, endPeriod: 1, startWeek: 1, endWeek: totalWeeks, weeks: 'all' })
const dayOffset = (start: string, offset: number) => { const d = new Date(`${start}T00:00:00`); d.setDate(d.getDate() + offset); return d }
const weekNow = (start: string, total: number) => Math.max(1, Math.min(total, Math.floor((Date.UTC(...dateParts(dateString(new Date()))) - Date.UTC(...dateParts(start))) / 604800000) + 1))
function dateParts(s: string): [number, number, number] { const [y = 0, m = 1, d = 1] = s.split('-').map(Number); return [y, m - 1, d] }

export default function TimetablePage() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const text = (zh: string, english: string) => en ? english : zh
  const days = en ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const user = useAuth((s) => s.user)
  const editable = can(user, 'timetable.manage')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['timetable'], queryFn: () => get<Timetable>('/timetable') })
  const [week, setWeek] = useState(1)
  const [draft, setDraft] = useState<Timetable | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [validation, setValidation] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  useDocumentTitle(text('课程表', 'Timetable'))
  useEffect(() => { if (query.data) setWeek(weekNow(query.data.startDate, query.data.totalWeeks)) }, [query.data?.startDate, query.data?.totalWeeks])
  useEffect(() => { if (draft) editorRef.current?.scrollIntoView({ block: 'start' }) }, [!!draft])
  const save = useMutation({
    mutationFn: (data: Timetable) => put<Timetable>('/timetable', data),
    onSuccess: (data) => { qc.setQueryData(['timetable'], data); setDraft(null); setLesson(null); setValidation(''); toast.success(text('课程表已保存', 'Timetable saved')) },
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (query.isPending) return <PageShell back><main className="page timetable"><Skeleton w={220} h={32} /><Skeleton h={400} style={{ marginTop: 32 }} /></main></PageShell>
  if (query.isError || !query.data) return <PageShell back><main className="page timetable"><StateView icon="alert" title={text('课程表加载失败', 'Unable to load timetable')} body={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>{text('重试', 'Retry')}</Button>} /></main></PageShell>
  const timetable = query.data
  const active = timetable.lessons.filter((item) => activeLesson(item, week))
  const weekStart = dayOffset(timetable.startDate, (week - 1) * 7)
  const format = (d: Date) => new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short', day: 'numeric' }).format(d)
  const setValue = <K extends keyof Lesson>(key: K, value: Lesson[K]) => setLesson((old) => old ? { ...old, [key]: value } : old)
  const addLesson = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || !lesson) return
    const next = { ...draft, lessons: [...draft.lessons.filter((item) => item.id !== lesson.id), lesson] }
    const issue = validateTimetable(next)
    if (issue) { setValidation(issue); return }
    setDraft(next); setLesson(null); setValidation('')
  }
  const saveDraft = () => {
    if (!draft) return
    const issue = validateTimetable(draft)
    if (issue) { setValidation(issue); return }
    setValidation(''); save.mutate(draft)
  }
  const errorText = validation === 'size' ? text('课程表数据过大，请减少课程或缩短名称。', 'The timetable is too large. Reduce the number or length of lessons.') : validation === 'conflict' ? text('课程在相同周次和节次冲突，请调整。', 'Lessons overlap in the same week and period.') : validation === 'term' ? text('请填写有效学期，开学日期须为周一，周数为 1–40。', 'Choose a Monday start date and 1–40 weeks.') : validation === 'periods' ? text('请检查节次时间，时间需依次排列且不能重叠。', 'Check that period times are valid and do not overlap.') : text('请检查课程的名称、周次和节次范围。', 'Check the lesson name, weeks and periods.')
  return <PageShell back><main className="page timetable">
    <Link to="/center" className="btn btn-ghost btn-sm timetable__back"><Icon name="arrowLeft" /> {text('班级中心', 'Class center')}</Link>
    <div className="timetable__heading"><div><h1 className="page__title">{text('课程表', 'Timetable')}</h1><p className="page__sub">{timetable.term || text('尚未设置学期', 'Term not set')} · {format(weekStart)} – {format(dayOffset(timetable.startDate, week * 7 - 1))}</p></div>
      {editable && !draft && <Button variant="secondary" icon="edit" onClick={() => { setDraft(structuredClone(timetable)); setValidation('') }}>{text('编辑课程表', 'Edit timetable')}</Button>}
    </div>
    <div className="timetable__toolbar"><div className="timetable__week"><Button size="sm" variant="secondary" icon="chevronLeft" iconOnly aria-label={text('上一周', 'Previous week')} disabled={week <= 1} onClick={() => setWeek(week - 1)} /><label><span className="sr-only">{text('选择周次', 'Select week')}</span><Select value={week} onChange={(e) => setWeek(Number(e.target.value))}>{Array.from({ length: timetable.totalWeeks }, (_, i) => <option key={i + 1} value={i + 1}>{text(`第 ${i + 1} 周`, `Week ${i + 1}`)}</option>)}</Select></label><Button size="sm" variant="secondary" icon="chevronRight" iconOnly aria-label={text('下一周', 'Next week')} disabled={week >= timetable.totalWeeks} onClick={() => setWeek(week + 1)} /><Button size="sm" variant="ghost" onClick={() => setWeek(weekNow(timetable.startDate, timetable.totalWeeks))}>{text('本周', 'Current week')}</Button></div><span className="muted small">{text(`${active.length} 门课程`, `${active.length} ${active.length === 1 ? 'lesson' : 'lessons'}`)}</span></div>
    <p className="timetable__scroll-hint">{text('左右滑动查看一周课程', 'Scroll horizontally to see the full week')}</p><div className="timetable__scroll" tabIndex={0} aria-label={text('每周课程表，可横向滚动', 'Weekly timetable, scroll horizontally')}><table className="timetable__table"><thead><tr><th scope="col">{text('节次', 'Period')}</th>{days.map((day, index) => <th scope="col" key={day}><span>{day}</span><small>{format(dayOffset(timetable.startDate, (week - 1) * 7 + index))}</small></th>)}</tr></thead><tbody>{timetable.periods.map((period, index) => <tr key={index}><th scope="row"><strong>{index + 1}</strong><small>{period.start}<br />{period.end}</small></th>{days.map((_, day) => {
      const item = active.find((c) => c.day === day + 1 && c.startPeriod <= index + 1 && c.endPeriod >= index + 1)
      if (item && item.startPeriod !== index + 1) return null
      return <td key={day} rowSpan={item ? item.endPeriod - item.startPeriod + 1 : undefined}>{item && <div className="timetable__lesson"><strong>{item.name}</strong>{item.teacher && <span>{item.teacher}</span>}{item.room && <span>{item.room}</span>}</div>}</td>
    })}</tr>)}</tbody></table></div>
    {!active.length && <p className="timetable__empty">{text('本周暂无课程。', 'No lessons this week.')}</p>}
    {draft && <section ref={editorRef} className="timetable__editor" aria-labelledby="timetable-edit-title">
      <div className="timetable__editor-head"><div><h2 id="timetable-edit-title" className="page__h">{text('编辑课程表', 'Edit timetable')}</h2><p className="muted small">{text('修改只在保存后对成员可见。', 'Changes are visible to members after saving.')}</p></div><Button variant="ghost" size="sm" onClick={() => { setDraft(null); setLesson(null); setValidation('') }}>{text('取消编辑', 'Cancel editing')}</Button></div>
      <div className="timetable__settings"><Field label={text('学期名称', 'Term name')}><Input maxLength={100} value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} /></Field><Field label={text('第一周周一', 'First Monday')}><Input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></Field><Field label={text('总周数', 'Total weeks')}><Input type="number" min={1} max={40} value={draft.totalWeeks} onChange={(e) => setDraft({ ...draft, totalWeeks: Number(e.target.value) })} /></Field></div>
      <h3 className="timetable__subhead">{text('上课时间', 'Period times')}</h3><div className="timetable__periods">{draft.periods.map((period, index) => <div key={index} className="timetable__period"><span>{text(`第 ${index + 1} 节`, `Period ${index + 1}`)}</span><Input aria-label={text(`第 ${index + 1} 节开始时间`, `Period ${index + 1} start`)} type="time" value={period.start} onChange={(e) => setDraft({ ...draft, periods: draft.periods.map((p, i) => i === index ? { ...p, start: e.target.value } : p) })} /><span>–</span><Input aria-label={text(`第 ${index + 1} 节结束时间`, `Period ${index + 1} end`)} type="time" value={period.end} onChange={(e) => setDraft({ ...draft, periods: draft.periods.map((p, i) => i === index ? { ...p, end: e.target.value } : p) })} /><Button type="button" size="sm" variant="ghost" icon="trash" iconOnly aria-label={text(`删除第 ${index + 1} 节`, `Remove period ${index + 1}`)} disabled={draft.periods.length <= 1 || index !== draft.periods.length - 1} onClick={() => setDraft({ ...draft, periods: draft.periods.slice(0, -1) })} /></div>)}</div>
      <Button variant="secondary" size="sm" icon="plus" disabled={draft.periods.length >= 20} onClick={() => setDraft({ ...draft, periods: [...draft.periods, { start: '', end: '' }] })}>{text('添加节次', 'Add period')}</Button>
      <div className="timetable__list-head"><h3 className="timetable__subhead">{text('课程安排', 'Lessons')} <span className="muted">{draft.lessons.length}</span></h3><Button size="sm" variant="secondary" icon="plus" onClick={() => { setLesson(newLesson(draft.totalWeeks)); setValidation('') }}>{text('添加课程', 'Add lesson')}</Button></div>
      <div className="timetable__list">{draft.lessons.length === 0 && <p className="muted">{text('还没有课程，添加第一门课程。', 'No lessons yet. Add the first lesson.')}</p>}{[...draft.lessons].sort((a, b) => a.day - b.day || a.startPeriod - b.startPeriod).map((c) => <div className="timetable__list-item" key={c.id}><div><strong>{c.name}</strong><div className="muted small">{days[c.day - 1]} · {c.startPeriod}–{c.endPeriod} · {c.startWeek}–{c.endWeek} {text('周', 'weeks')} · {c.weeks === 'all' ? text('每周', 'every week') : c.weeks === 'odd' ? text('单周', 'odd weeks') : text('双周', 'even weeks')} {c.room && `· ${c.room}`}</div></div><Button variant="ghost" size="sm" onClick={() => { setLesson({ ...c }); setValidation('') }}>{text('编辑', 'Edit')}</Button><Button variant="ghost" size="sm" onClick={() => { setDraft({ ...draft, lessons: draft.lessons.filter((item) => item.id !== c.id) }); if (lesson?.id === c.id) setLesson(null) }}>{text('删除', 'Delete')}</Button></div>)}</div>
      {lesson && <form className="timetable__lesson-form" onSubmit={addLesson}><h3 className="timetable__subhead">{draft.lessons.some((c) => c.id === lesson.id) ? text('编辑课程', 'Edit lesson') : text('新课程', 'New lesson')}</h3><div className="timetable__fields">
        <Field label={text('课程名称', 'Lesson name')}><Input required maxLength={100} value={lesson.name} onChange={(e) => setValue('name', e.target.value)} /></Field><Field label={text('教师', 'Teacher')}><Input maxLength={100} value={lesson.teacher} onChange={(e) => setValue('teacher', e.target.value)} /></Field><Field label={text('地点', 'Room')}><Input maxLength={100} value={lesson.room} onChange={(e) => setValue('room', e.target.value)} /></Field>
        <Field label={text('星期', 'Day')}><Select value={lesson.day} onChange={(e) => setValue('day', Number(e.target.value))}>{days.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select></Field><Field label={text('开始节次', 'First period')}><Input type="number" min={1} max={draft.periods.length} value={lesson.startPeriod} onChange={(e) => setValue('startPeriod', Number(e.target.value))} /></Field><Field label={text('结束节次', 'Last period')}><Input type="number" min={1} max={draft.periods.length} value={lesson.endPeriod} onChange={(e) => setValue('endPeriod', Number(e.target.value))} /></Field><Field label={text('开始周', 'First week')}><Input type="number" min={1} max={draft.totalWeeks} value={lesson.startWeek} onChange={(e) => setValue('startWeek', Number(e.target.value))} /></Field><Field label={text('结束周', 'Last week')}><Input type="number" min={1} max={draft.totalWeeks} value={lesson.endWeek} onChange={(e) => setValue('endWeek', Number(e.target.value))} /></Field><Field label={text('重复', 'Repeat')}><Select value={lesson.weeks} onChange={(e) => setValue('weeks', e.target.value as Lesson['weeks'])}><option value="all">{text('每周', 'Every week')}</option><option value="odd">{text('单周', 'Odd weeks')}</option><option value="even">{text('双周', 'Even weeks')}</option></Select></Field>
      </div><div className="timetable__actions"><Button type="submit" variant="secondary">{text('加入课程表', 'Apply lesson')}</Button><Button type="button" variant="ghost" onClick={() => { setLesson(null); setValidation('') }}>{text('取消', 'Cancel')}</Button></div></form>}
      {validation && <p className="form-error" role="alert">{errorText}</p>}
      <div className="timetable__actions"><Button variant="primary" loading={save.isPending} disabled={!!lesson} onClick={saveDraft}>{text('保存课程表', 'Save timetable')}</Button><Button variant="secondary" onClick={() => { const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'classight-timetable.json'; a.click(); URL.revokeObjectURL(url) }}>{text('导出 JSON', 'Export JSON')}</Button><Button variant="secondary" onClick={() => importRef.current?.click()}>{text('导入 JSON', 'Import JSON')}</Button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 500_000) throw new Error(); const imported = JSON.parse(await file.text()) as Timetable; if (!Array.isArray(imported.periods) || !Array.isArray(imported.lessons) || validateTimetable(imported)) throw new Error(); setDraft({ ...imported, version: draft.version }); setLesson(null); setValidation('') } catch { toast.error(text('文件格式无效，请选择有效课程表。', 'Invalid timetable file.')) } finally { e.target.value = '' } }} /></div>
      <p className="muted small">{text('默认节次可按实际作息调整；保存前请检查课程冲突。', 'Adjust period times to your school day and review conflicts before saving.')}</p>
    </section>}
  </main></PageShell>
}
