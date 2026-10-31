export interface Period { start: string; end: string }
export interface Lesson { id: string; name: string; teacher: string; room: string; day: number; startPeriod: number; endPeriod: number; startWeek: number; endWeek: number; weeks: 'all' | 'odd' | 'even' }
export interface Timetable { term: string; startDate: string; totalWeeks: number; periods: Period[]; lessons: Lesson[]; version: number }

export const defaultPeriods: Period[] = [
  { start: '08:00', end: '08:45' }, { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' }, { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' }, { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' }, { start: '16:55', end: '17:40' },
]

export function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function monday(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - (d.getDay() + 6) % 7)
  return dateString(d)
}
export function emptyTimetable(): Timetable { return { term: '', startDate: monday(), totalWeeks: 20, periods: defaultPeriods.map((p) => ({ ...p })), lessons: [], version: 0 } }
export function activeLesson(lesson: Lesson, week: number) { return week >= lesson.startWeek && week <= lesson.endWeek && (lesson.weeks === 'all' || (lesson.weeks === 'odd' ? week % 2 === 1 : week % 2 === 0)) }
export function conflictingLessons(a: Lesson, b: Lesson) {
  if (a.day !== b.day || a.startPeriod > b.endPeriod || b.startPeriod > a.endPeriod) return false
  for (let w = Math.max(a.startWeek, b.startWeek); w <= Math.min(a.endWeek, b.endWeek); w++) if (activeLesson(a, w) && activeLesson(b, w)) return true
  return false
}
export function validateTimetable(t: Timetable): string | undefined {
  if (JSON.stringify(t).replace(/[^\x20-\x7e]|[<>&+']/g, '\\u0000').length > 60000) return 'size'
  const start = new Date(`${t.startDate}T00:00:00`)
  if (t.term.length > 100 || Number.isNaN(start.getTime()) || dateString(start) !== t.startDate || start.getDay() !== 1 || !Number.isInteger(t.totalWeeks) || t.totalWeeks < 1 || t.totalWeeks > 40) return 'term'
  if (!t.periods.length || t.periods.length > 20 || t.lessons.length > 1000) return 'periods'
  if (t.periods.some((p, i) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end) || p.start >= p.end || (i > 0 && p.start < t.periods[i - 1]!.end))) return 'periods'
  const ids = new Set<string>()
  for (let i = 0; i < t.lessons.length; i++) {
    const c = t.lessons[i]!
    if (!c.id || ids.has(c.id) || !c.name.trim() || c.name.length > 100 || c.teacher.length > 100 || c.room.length > 100 || ![c.day, c.startPeriod, c.endPeriod, c.startWeek, c.endWeek].every(Number.isInteger) || c.day < 1 || c.day > 7 || c.startPeriod < 1 || c.endPeriod < c.startPeriod || c.endPeriod > t.periods.length || c.startWeek < 1 || c.endWeek < c.startWeek || c.endWeek > t.totalWeeks || !['all', 'odd', 'even'].includes(c.weeks)) return 'lessons'
    if (t.lessons.slice(0, i).some((p) => conflictingLessons(p, c))) return 'conflict'
    ids.add(c.id)
  }
  return undefined
}
