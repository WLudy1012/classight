import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { can, useAuth } from '@/features/auth/store'
import { get, put } from '@/shared/api/client'
import { useDocumentTitle } from '@/shared/hooks'
import { errorMessage } from '@/shared/i18n'
import { Button, Field, Input, Select, Skeleton, StateView, TabPanel, Tabs, toast, useTabsId } from '@/shared/ui'
import { activeLesson, dateString, validateTimetable, type Lesson, type Timetable } from './model'
import './timetable.css'

type EditorSection = 'lessons' | 'schedule'
const newLesson = (totalWeeks: number): Lesson => ({ id: crypto.randomUUID(), name: '', teacher: '', room: '', day: 1, startPeriod: 1, endPeriod: 1, startWeek: 1, endWeek: totalWeeks, weeks: 'all' })
const dayOffset = (start: string, offset: number) => { const date = new Date(`${start}T00:00:00`); date.setDate(date.getDate() + offset); return date }
function dateParts(value: string): [number, number, number] { const [year = 0, month = 1, day = 1] = value.split('-').map(Number); return [year, month - 1, day] }
const weekNow = (start: string, total: number) => Math.max(1, Math.min(total, Math.floor((Date.UTC(...dateParts(dateString(new Date()))) - Date.UTC(...dateParts(start))) / 604800000) + 1))

function exportTimetable(timetable: Timetable) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(timetable, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'classight-timetable.json'
  link.click()
  URL.revokeObjectURL(url)
}

export default function TimetablePage() {
  const { i18n } = useTranslation()
  const en = i18n.language.startsWith('en')
  const text = (zh: string, english: string) => en ? english : zh
  const days = en ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const editable = can(useAuth((state) => state.user), 'timetable.manage')
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['timetable'], queryFn: () => get<Timetable>('/timetable') })
  const [week, setWeek] = useState(1)
  const [draft, setDraft] = useState<Timetable | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [section, setSection] = useState<EditorSection>('lessons')
  const [validation, setValidation] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const tabsId = useTabsId()
  useDocumentTitle(text('课程表', 'Timetable'))
  useEffect(() => { if (query.data) setWeek(weekNow(query.data.startDate, query.data.totalWeeks)) }, [query.data?.startDate, query.data?.totalWeeks])
  const save = useMutation({
    mutationFn: (data: Timetable) => put<Timetable>('/timetable', data),
    onSuccess: (data) => { qc.setQueryData(['timetable'], data); setDraft(null); setLesson(null); setValidation(''); toast.success(text('课程表已保存', 'Timetable saved')) },
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (query.isPending) return <div className="page timetable"><Skeleton w={220} h={32} /><Skeleton h={400} style={{ marginTop: 32 }} /></div>
  if (query.isError || !query.data) return <div className="page timetable"><StateView icon="alert" title={text('课程表加载失败', 'Unable to load timetable')} body={errorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>{text('重试', 'Retry')}</Button>} /></div>

  const timetable = query.data
  const active = timetable.lessons.filter((item) => activeLesson(item, week))
  const weekStart = dayOffset(timetable.startDate, (week - 1) * 7)
  const format = (date: Date) => new Intl.DateTimeFormat(en ? 'en' : 'zh-CN', { month: 'short', day: 'numeric' }).format(date)
  const setValue = <K extends keyof Lesson>(key: K, value: Lesson[K]) => setLesson((old) => old ? { ...old, [key]: value } : old)
  const beginEditing = () => { setDraft(structuredClone(timetable)); setSection('lessons'); setLesson(null); setValidation('') }
  const cancelEditing = () => { setDraft(null); setLesson(null); setValidation('') }
  const reportIssue = (issue: string) => { setValidation(issue); setSection(issue === 'term' || issue === 'periods' ? 'schedule' : 'lessons') }
  const addLesson = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || !lesson) return
    const next = { ...draft, lessons: [...draft.lessons.filter((item) => item.id !== lesson.id), lesson] }
    const issue = validateTimetable(next)
    if (issue) { reportIssue(issue); return }
    setDraft(next); setLesson(null); setValidation('')
  }
  const saveDraft = () => {
    if (!draft || lesson) return
    const issue = validateTimetable(draft)
    if (issue) { reportIssue(issue); return }
    setValidation(''); save.mutate(draft)
  }
  const importTimetable = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !draft) return
    try {
      if (file.size > 500_000) throw new Error()
      const imported = JSON.parse(await file.text()) as Timetable
      if (!Array.isArray(imported.periods) || !Array.isArray(imported.lessons) || validateTimetable(imported)) throw new Error()
      setDraft({ ...imported, version: draft.version }); setLesson(null); setValidation('')
      toast.success(text('已导入草稿，保存后生效。', 'Imported into the draft. Save to publish changes.'))
    } catch { toast.error(text('文件格式无效，请选择有效课程表。', 'Invalid timetable file.')) }
    finally { event.target.value = '' }
  }
  const errorText = validation === 'size' ? text('课程表数据过大，请减少课程或缩短名称。', 'The timetable is too large. Reduce the number or length of lessons.')
    : validation === 'conflict' ? text('课程在相同周次和节次冲突，请调整。', 'Lessons overlap in the same week and period.')
      : validation === 'term' ? text('请检查学期信息，开学日期须为周一，周数为 1–40。', 'Choose a Monday start date and 1–40 weeks.')
        : validation === 'periods' ? text('请检查节次时间，时间需依次排列且不能重叠。', 'Check that period times are valid and do not overlap.')
          : text('请检查课程的名称、周次和节次范围。', 'Check the lesson name, weeks and periods.')

  return <div className="page timetable">
    <div className="timetable__heading">
      <div>
        <h1 className="page__title">{draft ? text('编辑课程表', 'Edit timetable') : text('课程表', 'Timetable')}</h1>
        <p className="page__sub">{draft ? text('先调整安排，再统一保存。', 'Make your changes, then save them together.') : `${timetable.term || text('尚未设置学期', 'Term not set')} · ${format(weekStart)} – ${format(dayOffset(timetable.startDate, week * 7 - 1))}`}</p>
      </div>
      {editable && !draft && <Button variant="secondary" icon="edit" onClick={beginEditing}>{text('编辑安排', 'Edit schedule')}</Button>}
      {draft && <Button variant="ghost" onClick={cancelEditing} disabled={save.isPending}>{text('返回课表', 'Back to timetable')}</Button>}
    </div>

    {!draft ? <>
      <div className="timetable__toolbar">
        <div className="timetable__week">
          <Button size="sm" variant="secondary" icon="chevronLeft" iconOnly aria-label={text('上一周', 'Previous week')} disabled={week <= 1} onClick={() => setWeek(week - 1)} />
          <label><span className="sr-only">{text('选择周次', 'Select week')}</span><Select value={week} onChange={(event) => setWeek(Number(event.target.value))}>{Array.from({ length: timetable.totalWeeks }, (_, index) => <option key={index + 1} value={index + 1}>{text(`第 ${index + 1} 周`, `Week ${index + 1}`)}</option>)}</Select></label>
          <Button size="sm" variant="secondary" icon="chevronRight" iconOnly aria-label={text('下一周', 'Next week')} disabled={week >= timetable.totalWeeks} onClick={() => setWeek(week + 1)} />
          <Button size="sm" variant="ghost" onClick={() => setWeek(weekNow(timetable.startDate, timetable.totalWeeks))}>{text('本周', 'Current week')}</Button>
        </div>
        <span className="muted small">{text(`${active.length} 门课程`, `${active.length} ${active.length === 1 ? 'lesson' : 'lessons'}`)}</span>
      </div>
      <p className="timetable__scroll-hint">{text('左右滑动查看一周课程', 'Scroll horizontally to see the full week')}</p>
      <div className="timetable__scroll" tabIndex={0} aria-label={text('每周课程表，可横向滚动', 'Weekly timetable, scroll horizontally')}>
        <table className="timetable__table">
          <thead><tr><th scope="col">{text('节次', 'Period')}</th>{days.map((day, index) => <th scope="col" key={day}><span>{day}</span><small>{format(dayOffset(timetable.startDate, (week - 1) * 7 + index))}</small></th>)}</tr></thead>
          <tbody>{timetable.periods.map((period, index) => <tr key={index}>
            <th scope="row"><strong>{index + 1}</strong><small>{period.start}<br />{period.end}</small></th>
            {days.map((_, day) => {
              const item = active.find((course) => course.day === day + 1 && course.startPeriod <= index + 1 && course.endPeriod >= index + 1)
              if (item && item.startPeriod !== index + 1) return null
              return <td key={day} rowSpan={item ? item.endPeriod - item.startPeriod + 1 : undefined}>{item && <div className="timetable__lesson"><strong>{item.name}</strong>{item.teacher && <span>{item.teacher}</span>}{item.room && <span>{item.room}</span>}</div>}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {!active.length && <p className="timetable__empty">{text('本周暂无课程。', 'No lessons this week.')}</p>}
    </> : <div className="timetable__editor">
      <Tabs idBase={tabsId} value={section} onChange={setSection} label={text('编辑课程表', 'Edit timetable')} tabs={[
        { key: 'lessons', label: text('课程安排', 'Lessons'), count: draft.lessons.length, disabled: save.isPending },
        { key: 'schedule', label: text('学期与作息', 'Term and periods'), disabled: !!lesson || save.isPending },
      ]} />
      <fieldset className="timetable__fieldset" disabled={save.isPending}>
        <TabPanel idBase={tabsId} tabKey="lessons" value={section}>
          {lesson ? <form className="timetable__lesson-form" onSubmit={addLesson}>
            <div className="timetable__section-heading"><h2>{draft.lessons.some((course) => course.id === lesson.id) ? text('编辑课程', 'Edit lesson') : text('添加课程', 'Add lesson')}</h2><Button variant="ghost" size="sm" onClick={() => { setLesson(null); setValidation('') }}>{text('取消', 'Cancel')}</Button></div>
            <div className="timetable__fields">
              <Field label={text('课程名称', 'Lesson name')}><Input autoFocus required maxLength={100} value={lesson.name} onChange={(event) => setValue('name', event.target.value)} /></Field>
              <Field label={text('教师', 'Teacher')}><Input maxLength={100} value={lesson.teacher} onChange={(event) => setValue('teacher', event.target.value)} /></Field>
              <Field label={text('地点', 'Room')}><Input maxLength={100} value={lesson.room} onChange={(event) => setValue('room', event.target.value)} /></Field>
              <Field label={text('星期', 'Day')}><Select value={lesson.day} onChange={(event) => setValue('day', Number(event.target.value))}>{days.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</Select></Field>
              <Field label={text('开始节次', 'First period')}><Input type="number" min={1} max={draft.periods.length} value={lesson.startPeriod} onChange={(event) => setValue('startPeriod', Number(event.target.value))} /></Field>
              <Field label={text('结束节次', 'Last period')}><Input type="number" min={1} max={draft.periods.length} value={lesson.endPeriod} onChange={(event) => setValue('endPeriod', Number(event.target.value))} /></Field>
              <Field label={text('开始周', 'First week')}><Input type="number" min={1} max={draft.totalWeeks} value={lesson.startWeek} onChange={(event) => setValue('startWeek', Number(event.target.value))} /></Field>
              <Field label={text('结束周', 'Last week')}><Input type="number" min={1} max={draft.totalWeeks} value={lesson.endWeek} onChange={(event) => setValue('endWeek', Number(event.target.value))} /></Field>
              <Field label={text('重复', 'Repeat')}><Select value={lesson.weeks} onChange={(event) => setValue('weeks', event.target.value as Lesson['weeks'])}><option value="all">{text('每周', 'Every week')}</option><option value="odd">{text('单周', 'Odd weeks')}</option><option value="even">{text('双周', 'Even weeks')}</option></Select></Field>
            </div>
            <Button type="submit" variant="secondary">{text('确认课程', 'Apply lesson')}</Button>
          </form> : <>
            <div className="timetable__section-heading"><div><h2>{text('课程安排', 'Lessons')}</h2><p>{text('按星期和节次排列，可设置每周、单周或双周。', 'Organized by day and period, with weekly or alternating repeats.')}</p></div><Button size="sm" variant="secondary" icon="plus" onClick={() => { setLesson(newLesson(draft.totalWeeks)); setValidation('') }}>{text('添加课程', 'Add lesson')}</Button></div>
            <div className="timetable__list">
              {!draft.lessons.length && <StateView title={text('还没有课程', 'No lessons yet')} body={text('添加课程后，成员即可按周查看安排。', 'Add lessons to build the weekly timetable.')} />}
              {[...draft.lessons].sort((a, b) => a.day - b.day || a.startPeriod - b.startPeriod).map((course) => <div className="timetable__list-item" key={course.id}>
                <div className="timetable__list-time"><strong>{days[course.day - 1]}</strong><span>{text(`${course.startPeriod}–${course.endPeriod} 节`, `Periods ${course.startPeriod}–${course.endPeriod}`)}</span></div>
                <div className="timetable__list-main"><strong>{course.name}</strong><span>{[course.teacher, course.room, text(`第 ${course.startWeek}–${course.endWeek} 周`, `Weeks ${course.startWeek}–${course.endWeek}`), course.weeks === 'all' ? text('每周', 'Every week') : course.weeks === 'odd' ? text('单周', 'Odd weeks') : text('双周', 'Even weeks')].filter(Boolean).join(' · ')}</span></div>
                <div className="timetable__row-actions"><Button variant="ghost" size="sm" aria-label={text(`编辑 ${course.name}`, `Edit ${course.name}`)} onClick={() => { setLesson({ ...course }); setValidation('') }}>{text('编辑', 'Edit')}</Button><Button variant="ghost" size="sm" aria-label={text(`删除 ${course.name}`, `Delete ${course.name}`)} onClick={() => setDraft({ ...draft, lessons: draft.lessons.filter((item) => item.id !== course.id) })}>{text('删除', 'Delete')}</Button></div>
              </div>)}
            </div>
          </>}
        </TabPanel>
        <TabPanel idBase={tabsId} tabKey="schedule" value={section}>
          <div className="timetable__section-heading"><div><h2>{text('学期', 'Term')}</h2><p>{text('第一周从周一开始，支持 1–40 周。', 'Start the first week on a Monday, with 1–40 weeks.')}</p></div></div>
          <div className="timetable__settings">
            <Field label={text('学期名称', 'Term name')}><Input maxLength={100} value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value })} /></Field>
            <Field label={text('第一周周一', 'First Monday')}><Input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></Field>
            <Field label={text('总周数', 'Total weeks')}><Input type="number" min={1} max={40} value={draft.totalWeeks} onChange={(event) => setDraft({ ...draft, totalWeeks: Number(event.target.value) })} /></Field>
          </div>
          <div className="timetable__section-heading timetable__section-heading--spaced"><div><h2>{text('作息时间', 'Period times')}</h2><p>{text('按实际作息填写，节次时间不能重叠。', 'Set your school day. Period times must not overlap.')}</p></div><Button variant="secondary" size="sm" icon="plus" disabled={draft.periods.length >= 20} onClick={() => setDraft({ ...draft, periods: [...draft.periods, { start: '', end: '' }] })}>{text('添加节次', 'Add period')}</Button></div>
          <div className="timetable__periods">{draft.periods.map((period, index) => <div key={index} className="timetable__period">
            <span>{text(`第 ${index + 1} 节`, `Period ${index + 1}`)}</span>
            <Input aria-label={text(`第 ${index + 1} 节开始时间`, `Period ${index + 1} start`)} type="time" value={period.start} onChange={(event) => setDraft({ ...draft, periods: draft.periods.map((item, position) => position === index ? { ...item, start: event.target.value } : item) })} />
            <span aria-hidden="true">–</span>
            <Input aria-label={text(`第 ${index + 1} 节结束时间`, `Period ${index + 1} end`)} type="time" value={period.end} onChange={(event) => setDraft({ ...draft, periods: draft.periods.map((item, position) => position === index ? { ...item, end: event.target.value } : item) })} />
            <Button size="sm" variant="ghost" icon="trash" iconOnly aria-label={text(`删除第 ${index + 1} 节`, `Remove period ${index + 1}`)} disabled={draft.periods.length <= 1 || index !== draft.periods.length - 1} onClick={() => setDraft({ ...draft, periods: draft.periods.slice(0, -1) })} />
          </div>)}</div>
        </TabPanel>
      </fieldset>
      <div className="timetable__savebar">
        <div className="timetable__save-note">{validation ? <p className="form-error" role="alert">{errorText}</p> : <p>{lesson ? text('请先确认或取消当前课程。', 'Apply or cancel the current lesson first.') : text('修改尚未发布，保存后对成员可见。', 'Changes are not published until you save.')}</p>}</div>
        <div className="timetable__save-actions">
          <Button size="sm" variant="ghost" disabled={!!lesson || save.isPending} onClick={() => importRef.current?.click()}>{text('导入 JSON', 'Import JSON')}</Button>
          <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => exportTimetable(draft)}>{text('导出 JSON', 'Export JSON')}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!!lesson} onClick={saveDraft}>{text('保存课程表', 'Save timetable')}</Button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importTimetable} />
        </div>
      </div>
    </div>}
  </div>
}
