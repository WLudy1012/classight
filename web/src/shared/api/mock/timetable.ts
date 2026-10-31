import { ApiError } from '../errors'
import { emptyTimetable, validateTimetable, type Timetable } from '@/features/timetable/model'
import { isPluginEnabled } from './plugin-state'
import type { Kit } from './speech'

const key = 'classight.mock.timetable.v1'
function read(): Timetable {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as Timetable : emptyTimetable() }
  catch { return emptyTimetable() }
}
export function registerTimetableRoutes({ route, need, currentUser }: Kit) {
  const enabled = () => { if (!isPluginEnabled('timetable')) throw ApiError.from(404, 'resource.not_found', 'Plugin unavailable') }
  route('GET', '/timetable', (ctx) => { currentUser(ctx); enabled(); return read() })
  route('PUT', '/timetable', (ctx) => {
    need(ctx, 'timetable.manage'); enabled()
    const input = ctx.body as Timetable
    if (input.version !== read().version) throw ApiError.from(409, 'resource.version_mismatch', 'Timetable changed')
    const error = validateTimetable(input)
    if (error) throw ApiError.from(400, 'validation.failed', error)
    const result = { ...input, version: input.version + 1 }
    localStorage.setItem(key, JSON.stringify(result))
    return result
  })
}
