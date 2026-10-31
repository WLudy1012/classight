import { ApiError } from '../errors'
import type { Kit } from './speech'

const ids = ['meetings', 'captcha', 'member-identity', 'timetable'] as const
const key = 'classight.mock.plugins.v1'
type States = Record<string, boolean>
function read(): States {
  try { return { meetings: true, captcha: false, 'member-identity': false, timetable: true, ...JSON.parse(localStorage.getItem(key) ?? '{}') } }
  catch { return { meetings: true, captcha: false, 'member-identity': false, timetable: true } }
}
export const isPluginEnabled = (id: string) => read()[id] === true
export function registerPluginRoutes({ route, need }: Kit) {
  route('GET', '/plugins', () => read())
  route('GET', '/admin/plugins', (ctx) => { need(ctx, 'site.settings.read'); const states = read(); return ids.map((id) => ({ id, enabled: states[id] })) })
  route('PUT', '/admin/plugins/:id', (ctx) => {
    need(ctx, 'site.settings.write')
    const id = ctx.params.id!
    if (!ids.includes(id as typeof ids[number])) throw ApiError.from(404, 'resource.not_found', 'Unknown plugin')
    if (typeof ctx.body?.enabled !== 'boolean') throw ApiError.from(400, 'validation.failed', 'Invalid state')
    if (id === 'captcha' && ctx.body.enabled) throw ApiError.from(400, 'validation.failed', 'Captcha is unavailable in demo mode')
    const states = { ...read(), [id]: ctx.body.enabled }
    localStorage.setItem(key, JSON.stringify(states))
    return { id, enabled: states[id] }
  })
}
