import { ApiError } from '../errors'
import type { Kit } from './speech'

const defaults = { meetings: true, captcha: false, 'member-identity': false, timetable: true, blog: true, chat: true }
const ids = Object.keys(defaults)
const key = 'classight.mock.plugins.v1'
function read(): Record<string, boolean> {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') } }
  catch { return { ...defaults } }
}
export const isPluginEnabled = (id: string) => read()[id] === true
export function registerPluginRoutes({ route, need }: Kit) {
  route('GET', '/plugins', () => read())
  route('GET', '/plugins/catalog', (ctx) => { need(ctx); return [
    { id: 'meetings', name: '班会课件', description: '班会场次、报名和课件', version: '1.0.0', workspacePath: 'meetings', category: 'class', icon: 'mic' },
    { id: 'timetable', name: '课程表', description: '学期周次与课程安排', version: '1.0.0', workspacePath: 'timetable', category: 'class', icon: 'calendar' },
    { id: 'blog', name: '班级博客', description: '班内文章和个人草稿', version: '1.0.0', workspacePath: 'blog', category: 'class', icon: 'file', permission: 'blog.read' },
    { id: 'chat', name: '班级群聊', description: '班级群聊与聊天记录', version: '1.0.0', workspacePath: 'chat', category: 'class', icon: 'chat', permission: 'chat.read' },
    { id: 'member-identity', name: '成员权限', description: '统一权限验证', version: '1.0.0', workspacePath: 'identity', category: 'account', icon: 'shield' },
    { id: 'captcha', name: '人机验证', description: '登录与注册验证', version: '1.0.0' },
  ] })
  route('GET', '/admin/plugins/runtime', (ctx) => { need(ctx, 'site.settings.read'); return [] })
  route('GET', '/admin/plugins', (ctx) => { need(ctx, 'site.settings.read'); const states = read(); return ids.map((id) => ({ id, enabled: states[id] })) })
  route('PUT', '/admin/plugins/:id', (ctx) => {
    need(ctx, 'site.settings.write')
    const id = ctx.params.id!
    if (!ids.includes(id)) throw ApiError.from(404, 'resource.not_found', 'Unknown plugin')
    if (typeof ctx.body?.enabled !== 'boolean') throw ApiError.from(400, 'validation.failed', 'Invalid state')
    if (id === 'captcha' && ctx.body.enabled) throw ApiError.from(400, 'validation.failed', 'Captcha is unavailable in demo mode')
    const states = { ...read(), [id]: ctx.body.enabled }
    localStorage.setItem(key, JSON.stringify(states))
    return { id, enabled: states[id] }
  })
}
