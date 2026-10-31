import { describe, expect, it } from 'vitest'
import { activeLesson, conflictingLessons, emptyTimetable, validateTimetable, type Lesson } from './model'

const lesson: Lesson = { id: '1', name: 'Math', teacher: '', room: '', day: 1, startPeriod: 1, endPeriod: 2, startWeek: 1, endWeek: 10, weeks: 'odd' }
describe('timetable weeks and conflicts', () => {
  it('allows alternating weeks but rejects actual overlaps', () => {
    expect(activeLesson(lesson, 3)).toBe(true)
    expect(activeLesson(lesson, 4)).toBe(false)
    expect(conflictingLessons(lesson, { ...lesson, id: '2', weeks: 'even' })).toBe(false)
    expect(conflictingLessons(lesson, { ...lesson, id: '2', weeks: 'all', startPeriod: 2 })).toBe(true)
    expect(conflictingLessons(lesson, { ...lesson, id: '2', startWeek: 11, endWeek: 12 })).toBe(false)
  })
  it('validates period times and course conflicts before saving', () => {
    const data = emptyTimetable()
    expect(validateTimetable({ ...data, lessons: [lesson, { ...lesson, id: '2', weeks: 'all' }] })).toBe('conflict')
    expect(validateTimetable({ ...data, periods: [{ start: '08:00', end: '08:45' }, { start: '08:40', end: '09:00' }] })).toBe('periods')
  })
})
