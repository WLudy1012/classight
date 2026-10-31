import { ApiError } from '../errors'
import type {
  AdminMember,
  AdminUser,
  AuthResult,
  ClassOverview,
  ClassProfile,
  ConsoleOverview,
  MemberPublic,
  Page,
  Permission,
  PermissionGroup,
  SessionInfo,
  SettingsEnvelope,
  SettingsGroupKey,
  SitePublic,
  SpeechSettings,
  SystemStatus,
  TimelineEvent,
  UserSelf,
} from '../types'
import { registerSetupRoutes } from './setup'
import { registerSpeechRoutes, validateSpeechSettings } from './speech'
import { isPluginEnabled, registerPluginRoutes } from './plugin-state'
import { registerTimetableRoutes } from './timetable'
import { ALL_PERMISSIONS, REFRESH_KEY, getDb, newId, persist, type DbMember, type DbTimeline, type DbUser, type L } from './db'

type Lang = 'zh' | 'en'

export interface Ctx {
  params: Record<string, string>
  query: Record<string, string | number | boolean | undefined>
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string>
  lang: Lang
}

type Result = unknown | { __status: number; body?: unknown }
export type Handler = (ctx: Ctx) => Result | Promise<Result>

export const status = (code: number, body?: unknown) => ({ __status: code, body })
const isStatus = (r: unknown): r is { __status: number; body?: unknown } =>
  typeof r === 'object' && r !== null && '__status' in r

/* ----------------------------- helpers ----------------------------- */

const ACCESS_TTL_S = 15 * 60
const tr = (l: L | undefined, lang: Lang) => (l ? l[lang] || l.zh || l.en : '')
const setL = (l: L | undefined, lang: Lang, v: string): L => ({ zh: l?.zh ?? v, en: l?.en ?? v, [lang]: v })

function rolePermissions(roleNames: string[]): Permission[] {
  const db = getDb()
  const set = new Set<Permission>()
  for (const r of db.roles) if (roleNames.includes(r.name)) r.permissions.forEach((p) => set.add(p))
  return [...set]
}

function toSelf(u: DbUser, lang: Lang): UserSelf {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    email: u.email,
    bio: tr(u.bio, lang),
    roles: u.roles,
    permissions: rolePermissions(u.roles),
    createdAt: u.createdAt,
    version: u.version,
  }
}

function toAdminUser(u: DbUser): AdminUser {
  const { password: _p, bio: _b, ...rest } = u
  return rest
}

function toMember(m: DbMember, lang: Lang): MemberPublic {
  return {
    id: m.id,
    displayName: tr(m.name, lang),
    avatarUrl: m.avatarUrl,
    title: m.title ? tr(m.title, lang) : undefined,
    joinedOn: m.joinedOn,
    intro: m.intro ? tr(m.intro, lang) : undefined,
  }
}

function toTimeline(t: DbTimeline, lang: Lang, withBody = false): TimelineEvent {
  return {
    id: t.id,
    title: tr(t.title, lang),
    summary: tr(t.summary, lang),
    occurredOn: t.occurredOn,
    coverUrl: t.coverUrl,
    tags: t.tags,
    body: withBody ? tr(t.body, lang) : undefined,
  }
}

function toProfile(lang: Lang): ClassProfile {
  const db = getDb()
  const s = db.settings.site
  return {
    id: db.profile.id,
    name: lang === 'en' ? s.classNameEn || s.className : s.className,
    nameEn: s.classNameEn,
    motto: tr(db.profile.motto, lang),
    intro: tr(db.profile.intro, lang),
    foundedOn: db.profile.foundedOn,
    version: db.profile.version,
  }
}

function paginate<T>(items: T[], q: Ctx['query']): Page<T> {
  const page = Math.max(1, Number(q.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20) || 20))
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize }
}

function sortBy<T>(items: T[], sort: unknown, fallback?: string): T[] {
  const spec = String(sort || fallback || '')
  if (!spec) return items
  const keys = spec.split(',').filter(Boolean)
  return [...items].sort((a, b) => {
    for (const k of keys) {
      const desc = k.startsWith('-')
      const f = (desc ? k.slice(1) : k) as keyof T
      const av = a[f] as unknown
      const bv = b[f] as unknown
      if (av === bv) continue
      const c = (av ?? '') < (bv ?? '') ? -1 : 1
      return desc ? -c : c
    }
    return 0
  })
}

const matches = (q: unknown, ...fields: (string | undefined)[]) => {
  const s = String(q ?? '').trim().toLowerCase()
  return !s || fields.some((f) => f?.toLowerCase().includes(s))
}

function requireFields(body: Record<string, unknown> | undefined, fields: string[]) {
  const errors: Record<string, string[]> = {}
  for (const f of fields) {
    const v = body?.[f]
    if (v === undefined || v === null || String(v).trim() === '') errors[f] = ['required']
  }
  if (Object.keys(errors).length) throw ApiError.from(400, 'validation.failed', 'Validation failed', errors)
}

/* ------------------------------ auth ------------------------------- */

const makeAccess = (userId: string) => `mock.${userId}.${Date.now() + ACCESS_TTL_S * 1000}`

function currentUser(ctx: Ctx): DbUser {
  const h = ctx.headers.Authorization
  if (!h?.startsWith('Bearer ')) throw ApiError.from(401, 'auth.token_invalid', 'Not signed in')
  const [tag, uid, exp] = h.slice(7).split('.')
  if (tag !== 'mock' || !uid || !exp) throw ApiError.from(401, 'auth.token_invalid', 'Invalid token')
  if (Number(exp) < Date.now()) throw ApiError.from(401, 'auth.token_expired', 'Token expired')
  const u = getDb().users.find((x) => x.id === uid)
  if (!u) throw ApiError.from(401, 'auth.token_invalid', 'Unknown user')
  if (u.status === 'disabled') throw ApiError.from(403, 'auth.account_disabled', 'Account disabled')
  return u
}

function need(ctx: Ctx, ...perms: Permission[]): DbUser {
  const u = currentUser(ctx)
  const have = rolePermissions(u.roles)
  if (!perms.every((p) => have.includes(p))) throw ApiError.from(403, 'permission.denied', 'Permission denied')
  return u
}

function audit(
  actor: DbUser,
  action: string,
  resourceType: string,
  resourceId: string | undefined,
  summary: string,
  changes?: { field: string; before: unknown; after: unknown }[],
) {
  getDb().audit.unshift({
    id: newId(),
    at: new Date().toISOString(),
    actor: actor.username,
    action,
    resourceType,
    resourceId,
    summary,
    changes,
  })
}

function diff<T extends object>(before: T, after: Partial<T>) {
  const out: { field: string; before: unknown; after: unknown }[] = []
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push({ field: String(k), before: before[k], after: after[k] })
  }
  return out
}

function openSession(u: DbUser): DbSession_ {
  const db = getDb()
  const now = new Date().toISOString()
  const s = {
    id: newId(),
    userId: u.id,
    device: navigator.userAgent.includes('Mobile') ? 'Mobile browser' : 'Desktop browser',
    ip: '127.0.0.1',
    createdAt: now,
    lastSeenAt: now,
    refreshToken: newId(),
  }
  db.sessions.push(s)
  u.lastLoginAt = now
  try {
    localStorage.setItem(REFRESH_KEY, s.refreshToken)
  } catch {
    /* noop */
  }
  persist()
  return s
}
type DbSession_ = ReturnType<typeof getDb>['sessions'][number]

function authResult(u: DbUser, lang: Lang): AuthResult {
  return { accessToken: makeAccess(u.id), expiresIn: ACCESS_TTL_S, user: toSelf(u, lang) }
}

function currentSession(u: DbUser) {
  let rt: string | null = null
  try {
    rt = localStorage.getItem(REFRESH_KEY)
  } catch {
    /* noop */
  }
  return getDb().sessions.find((s) => s.userId === u.id && s.refreshToken === rt)
}

const failedLogins = new Map<string, number>()

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function readUpload(ctx: Ctx) {
  const f = ctx.body instanceof FormData ? ctx.body.get('file') : null
  if (!(f instanceof Blob)) throw ApiError.from(400, 'validation.failed', 'file required', { file: ['required'] })
  if (!f.type.startsWith('image/')) throw ApiError.from(422, 'media.unsupported_type', 'Only images are supported')
  const max = getDb().settings.storage.maxUploadMb * 1024 * 1024
  if (f.size > max) throw ApiError.from(422, 'media.unsupported_type', 'File too large')
  return { url: await fileToDataUrl(f), contentType: f.type, size: f.size }
}

/* ------------------------------ routes ------------------------------ */

const routes: [string, string, Handler][] = []
const route = (m: string, p: string, h: Handler) => routes.push([m, p, h])

/* site */
route('GET', '/site/public', (): SitePublic => {
  const s = getDb().settings
  return {
    className: s.site.className,
    classNameEn: s.site.classNameEn,
    slogan: s.site.slogan,
    appearance: {
      particleQualityDefault: s.appearance.particleQualityDefault,
      palette: { particle: s.appearance.particleColor, accent: s.appearance.accentColor },
    },
    registrationMode: s.security.registrationMode,
    apiVersion: 'v1-mock',
    features: { mongo: false, redis: false },
  }
})

/* auth */
let mockCaptchaConfig = { provider: 'cloudflare', siteKey: '', sceneId: '', region: 'cn', accessKeyId: '', secretConfigured: false, appSecretConfigured: false }
route('GET', '/auth/captcha', () => ({ enabled: false }))
route('GET', '/admin/plugins/captcha/config', (ctx) => { need(ctx, 'site.settings.read'); return mockCaptchaConfig })
route('PUT', '/admin/plugins/captcha/config', (ctx) => {
  need(ctx, 'site.settings.write')
  const b = ctx.body as { provider: string; siteKey: string; sceneId?: string; region?: string; accessKeyId?: string; secret?: string; appSecret?: string }
  const same = b.provider === mockCaptchaConfig.provider
  const next = { provider: b.provider, siteKey: b.siteKey, sceneId: b.sceneId ?? '', region: b.region ?? 'cn', accessKeyId: b.accessKeyId ?? '', secretConfigured: !!b.secret || (same && mockCaptchaConfig.secretConfigured), appSecretConfigured: !!b.appSecret || (same && mockCaptchaConfig.appSecretConfigured) }
  if (!next.siteKey || !next.secretConfigured || (next.provider === 'aliyun' && (!next.sceneId || !next.accessKeyId)) || (next.provider === 'tencent' && (!next.appSecretConfigured || !next.accessKeyId)) || !['cloudflare', 'aliyun', 'tencent'].includes(next.provider)) throw ApiError.from(422, 'validation.failed', 'Invalid captcha configuration')
  mockCaptchaConfig = next
  return status(204)
})
route('POST', '/auth/login', async (ctx) => {
  requireFields(ctx.body, ['account', 'password'])
  const { account, password } = ctx.body as { account: string; password: string }
  const key = account.toLowerCase()
  if ((failedLogins.get(key) ?? 0) >= 5) throw ApiError.from(423, 'auth.account_locked', 'Account temporarily locked')
  const u = getDb().users.find((x) => x.username.toLowerCase() === key || x.email?.toLowerCase() === key)
  if (!u || u.password !== password) {
    failedLogins.set(key, (failedLogins.get(key) ?? 0) + 1)
    throw ApiError.from(401, 'auth.invalid_credentials', 'Wrong account or password')
  }
  if (u.status === 'disabled') throw ApiError.from(403, 'auth.account_disabled', 'Account disabled')
  failedLogins.delete(key)
  openSession(u)
  return authResult(u, ctx.lang)
})

route('POST', '/auth/register', async (ctx) => {
  const db = getDb()
  if (db.settings.security.registrationMode === 'closed') throw ApiError.from(403, 'permission.denied', 'Registration is closed')
  requireFields(ctx.body, ['inviteCode', 'username', 'displayName', 'password'])
  const b = ctx.body as { inviteCode: string; username: string; displayName: string; password: string; email?: string }
  const inv = db.invites.find((i) => i.code === b.inviteCode.trim())
  if (!inv) throw ApiError.from(422, 'invite.invalid', 'Invalid invite code')
  if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) throw ApiError.from(410, 'invite.expired', 'Invite expired')
  if (inv.usedCount >= inv.maxUses) throw ApiError.from(422, 'invite.invalid', 'Invite fully used')
  if (b.password.length < db.settings.security.minPasswordLength)
    throw ApiError.from(422, 'password.too_weak', 'Password too short', { password: ['too_short'] })
  if (db.users.some((u) => u.username.toLowerCase() === b.username.toLowerCase()))
    throw ApiError.from(409, 'user.already_exists', 'Username taken', { username: ['taken'] })
  const u: DbUser = {
    id: newId(),
    username: b.username,
    password: b.password,
    displayName: b.displayName,
    email: b.email,
    roles: [inv.role],
    status: 'active',
    createdAt: new Date().toISOString(),
    version: 1,
    bio: { zh: '', en: '' },
  }
  db.users.push(u)
  inv.usedCount += 1
  openSession(u)
  return authResult(u, ctx.lang)
})

route('POST', '/auth/refresh', (ctx) => {
  let rt: string | null = null
  try {
    rt = localStorage.getItem(REFRESH_KEY)
  } catch {
    /* noop */
  }
  const s = getDb().sessions.find((x) => x.refreshToken === rt)
  const u = s && getDb().users.find((x) => x.id === s.userId)
  if (!s || !u || u.status === 'disabled') throw ApiError.from(401, 'auth.token_invalid', 'No valid session')
  s.refreshToken = newId() // rotation
  s.lastSeenAt = new Date().toISOString()
  try {
    localStorage.setItem(REFRESH_KEY, s.refreshToken)
  } catch {
    /* noop */
  }
  persist()
  return { accessToken: makeAccess(u.id), expiresIn: ACCESS_TTL_S, user: toSelf(u, ctx.lang) }
})

route('POST', '/auth/logout', (ctx) => {
  try {
    const u = currentUser(ctx)
    const s = currentSession(u)
    if (s) getDb().sessions = getDb().sessions.filter((x) => x.id !== s.id)
  } catch {
    /* already signed out */
  }
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* noop */
  }
  persist()
  return status(204)
})

route('POST', '/auth/logout-all', (ctx) => {
  const u = currentUser(ctx)
  getDb().sessions = getDb().sessions.filter((x) => x.userId !== u.id)
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* noop */
  }
  persist()
  return status(204)
})

route('GET', '/auth/me', (ctx) => toSelf(currentUser(ctx), ctx.lang))

route('POST', '/auth/password/change', (ctx) => {
  const u = currentUser(ctx)
  requireFields(ctx.body, ['currentPassword', 'newPassword'])
  const { currentPassword, newPassword } = ctx.body as { currentPassword: string; newPassword: string }
  if (u.password !== currentPassword) throw ApiError.from(401, 'auth.invalid_credentials', 'Current password is wrong', { currentPassword: ['wrong'] })
  if (newPassword.length < getDb().settings.security.minPasswordLength)
    throw ApiError.from(422, 'password.too_weak', 'Password too short', { newPassword: ['too_short'] })
  u.password = newPassword
  const cur = currentSession(u)
  getDb().sessions = getDb().sessions.filter((s) => s.userId !== u.id || s.id === cur?.id)
  persist()
  return status(204)
})

route('GET', '/auth/sessions', (ctx): SessionInfo[] => {
  const u = currentUser(ctx)
  const cur = currentSession(u)
  return getDb()
    .sessions.filter((s) => s.userId === u.id)
    .map((s) => ({ id: s.id, device: s.device, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === cur?.id }))
})

route('DELETE', '/auth/sessions/:id', (ctx) => {
  const u = currentUser(ctx)
  const db = getDb()
  const s = db.sessions.find((x) => x.id === ctx.params.id && x.userId === u.id)
  if (!s) throw ApiError.from(404, 'resource.not_found', 'Session not found')
  db.sessions = db.sessions.filter((x) => x.id !== s.id)
  persist()
  return status(204)
})

/* me */
route('GET', '/member-identity/permissions', (ctx) => {
  const user = currentUser(ctx)
  if (!isPluginEnabled('member-identity')) throw ApiError.from(404, 'resource.not_found', 'Plugin unavailable')
  return { permissions: rolePermissions(user.roles) }
})

route('GET', '/me/profile', (ctx) => toSelf(currentUser(ctx), ctx.lang))

route('PATCH', '/me/profile', (ctx) => {
  const u = currentUser(ctx)
  const b = ctx.body as { displayName?: string; bio?: string; email?: string; version: number }
  if (b.version !== u.version) throw ApiError.from(409, 'resource.version_mismatch', 'Profile changed elsewhere')
  if (b.displayName !== undefined && !b.displayName.trim())
    throw ApiError.from(400, 'validation.failed', 'Validation failed', { displayName: ['required'] })
  if (b.displayName !== undefined) u.displayName = b.displayName.trim()
  if (b.email !== undefined) u.email = b.email || undefined
  if (b.bio !== undefined) u.bio = setL(u.bio, ctx.lang, b.bio)
  u.version += 1
  persist()
  return toSelf(u, ctx.lang)
})

route('PUT', '/me/avatar', async (ctx) => {
  const u = currentUser(ctx)
  const f = await readUpload(ctx)
  u.avatarUrl = f.url
  u.version += 1
  persist()
  return { avatarUrl: u.avatarUrl }
})

route('DELETE', '/me/avatar', (ctx) => {
  const u = currentUser(ctx)
  u.avatarUrl = undefined
  u.version += 1
  persist()
  return status(204)
})

route('GET', '/me/console', (ctx): ConsoleOverview => {
  const u = currentUser(ctx)
  const self = toSelf(u, ctx.lang)
  const m = getDb().members.find((x) => x.linkedUserId === u.id)
  const all: { key: string; label: string; route: string; permission?: Permission }[] = [
    { key: 'profile', label: 'console.profile', route: '/console/profile' },
    { key: 'security', label: 'console.security', route: '/console/security' },
    { key: 'class', label: 'console.classInfo', route: '/class' },
    { key: 'admin', label: 'console.admin', route: '/admin', permission: 'site.settings.read' },
    { key: 'center', label: 'center.title', route: '/center', permission: undefined },
    { key: 'admin-users', label: 'console.adminUsers', route: '/admin/users', permission: 'users.read' },
  ]
  return {
    user: self,
    linkedMember: m ? toMember(m, ctx.lang) : undefined,
    shortcuts: all.filter((s) => !s.permission || self.permissions.includes(s.permission)),
    unreadNotifications: 0,
  }
})

/* media */
route('POST', '/media', async (ctx) => {
  need(ctx, 'media.upload')
  const f = await readUpload(ctx)
  return { id: newId(), ...f }
})

/* class (public) */
const classGate = (ctx: Ctx) => {
  if (!getDb().settings.security.classInfoPublic) currentUser(ctx)
}

route('GET', '/class/overview', (ctx): ClassOverview => {
  classGate(ctx)
  const db = getDb()
  const years = Math.max(0, Math.floor((Date.now() - new Date(db.profile.foundedOn).getTime()) / (365.25 * 86400000)))
  return {
    profile: toProfile(ctx.lang),
    stats: { memberCount: db.members.length, timelineCount: db.timeline.length, foundedYears: years },
    membersPreview: db.members.slice(0, 12).map((m) => toMember(m, ctx.lang)),
    latestTimeline: sortBy(db.timeline, '-occurredOn')
      .slice(0, 5)
      .map((t) => toTimeline(t, ctx.lang)),
  }
})
route('GET', '/class/profile', (ctx) => {
  classGate(ctx)
  return toProfile(ctx.lang)
})
route('GET', '/class/members', (ctx) => {
  classGate(ctx)
  const list = getDb()
    .members.map((m) => toMember(m, ctx.lang))
    .filter((m) => matches(ctx.query.q, m.displayName, m.title))
  return paginate(list, ctx.query)
})
route('GET', '/class/members/:id', (ctx) => {
  classGate(ctx)
  const m = getDb().members.find((x) => x.id === ctx.params.id)
  if (!m) throw ApiError.from(404, 'resource.not_found', 'Member not found')
  return toMember(m, ctx.lang)
})
route('GET', '/class/timeline', (ctx) => {
  classGate(ctx)
  let list = getDb().timeline
  if (ctx.query.year) list = list.filter((t) => t.occurredOn.startsWith(String(ctx.query.year)))
  return paginate(sortBy(list, '-occurredOn').map((t) => toTimeline(t, ctx.lang)), ctx.query)
})
route('GET', '/class/timeline/:id', (ctx) => {
  classGate(ctx)
  const t = getDb().timeline.find((x) => x.id === ctx.params.id)
  if (!t) throw ApiError.from(404, 'resource.not_found', 'Event not found')
  return toTimeline(t, ctx.lang, true)
})

/* admin: class */
route('PUT', '/admin/class/profile', (ctx) => {
  const u = need(ctx, 'class.profile.write')
  const db = getDb()
  const b = ctx.body as { motto: string; intro: string; foundedOn: string; version: number }
  if (b.version !== db.profile.version) throw ApiError.from(409, 'resource.version_mismatch', 'Profile changed elsewhere')
  requireFields(b as unknown as Record<string, unknown>, ['motto', 'intro', 'foundedOn'])
  const changes = diff({ motto: tr(db.profile.motto, ctx.lang), intro: tr(db.profile.intro, ctx.lang), foundedOn: db.profile.foundedOn }, b)
  db.profile.motto = setL(db.profile.motto, ctx.lang, b.motto)
  db.profile.intro = setL(db.profile.intro, ctx.lang, b.intro)
  db.profile.foundedOn = b.foundedOn
  db.profile.version += 1
  audit(u, 'class.profile.update', 'classProfile', db.profile.id, 'Updated class profile', changes)
  persist()
  return toProfile(ctx.lang)
})

const adminMember = (m: DbMember, lang: Lang): AdminMember => ({ ...toMember(m, lang), linkedUserId: m.linkedUserId, version: m.version })

route('GET', '/admin/class/members', (ctx) => {
  need(ctx, 'class.members.manage')
  const list = getDb()
    .members.map((m) => adminMember(m, ctx.lang))
    .filter((m) => matches(ctx.query.q, m.displayName, m.title))
  return paginate(sortBy(list, ctx.query.sort), ctx.query)
})
route('POST', '/admin/class/members', (ctx) => {
  const u = need(ctx, 'class.members.manage')
  requireFields(ctx.body, ['displayName'])
  const b = ctx.body as { displayName: string; title?: string; joinedOn?: string; intro?: string }
  const m: DbMember = {
    id: newId(),
    name: setL(undefined, ctx.lang, b.displayName),
    title: b.title ? setL(undefined, ctx.lang, b.title) : undefined,
    intro: b.intro ? setL(undefined, ctx.lang, b.intro) : undefined,
    joinedOn: b.joinedOn,
    version: 1,
  }
  getDb().members.push(m)
  audit(u, 'class.member.create', 'member', m.id, `Added member ${b.displayName}`)
  persist()
  return status(201, adminMember(m, ctx.lang))
})
route('PUT', '/admin/class/members/:id', (ctx) => {
  const u = need(ctx, 'class.members.manage')
  const m = getDb().members.find((x) => x.id === ctx.params.id)
  if (!m) throw ApiError.from(404, 'resource.not_found', 'Member not found')
  const b = ctx.body as { displayName: string; title?: string; joinedOn?: string; intro?: string; version: number }
  if (b.version !== m.version) throw ApiError.from(409, 'resource.version_mismatch', 'Changed elsewhere')
  requireFields(b as unknown as Record<string, unknown>, ['displayName'])
  m.name = setL(m.name, ctx.lang, b.displayName)
  m.title = b.title ? setL(m.title, ctx.lang, b.title) : undefined
  m.intro = b.intro ? setL(m.intro, ctx.lang, b.intro) : undefined
  m.joinedOn = b.joinedOn
  m.version += 1
  audit(u, 'class.member.update', 'member', m.id, `Updated member ${b.displayName}`)
  persist()
  return adminMember(m, ctx.lang)
})
route('DELETE', '/admin/class/members/:id', (ctx) => {
  const u = need(ctx, 'class.members.manage')
  const db = getDb()
  const m = db.members.find((x) => x.id === ctx.params.id)
  if (!m) throw ApiError.from(404, 'resource.not_found', 'Member not found')
  db.members = db.members.filter((x) => x !== m)
  audit(u, 'class.member.delete', 'member', m.id, `Removed member ${tr(m.name, ctx.lang)}`)
  persist()
  return status(204)
})
route('POST', '/admin/class/members/:id/link-user', (ctx) => {
  const u = need(ctx, 'class.members.manage')
  const db = getDb()
  const m = db.members.find((x) => x.id === ctx.params.id)
  if (!m) throw ApiError.from(404, 'resource.not_found', 'Member not found')
  requireFields(ctx.body, ['userId'])
  const target = db.users.find((x) => x.id === ctx.body.userId)
  if (!target) throw ApiError.from(404, 'resource.not_found', 'User not found')
  m.linkedUserId = target.id
  m.version += 1
  audit(u, 'class.member.link', 'member', m.id, `Linked member to ${target.username}`)
  persist()
  return adminMember(m, ctx.lang)
})
route('POST', '/admin/class/members/:id/unlink-user', (ctx) => {
  const u = need(ctx, 'class.members.manage')
  const m = getDb().members.find((x) => x.id === ctx.params.id)
  if (!m) throw ApiError.from(404, 'resource.not_found', 'Member not found')
  m.linkedUserId = undefined
  m.version += 1
  audit(u, 'class.member.unlink', 'member', m.id, 'Unlinked member from user')
  persist()
  return adminMember(m, ctx.lang)
})

route('GET', '/admin/class/timeline', (ctx) => {
  need(ctx, 'class.timeline.manage')
  return paginate(sortBy(getDb().timeline, '-occurredOn').map((t) => toTimeline(t, ctx.lang, true)), ctx.query)
})
route('POST', '/admin/class/timeline', (ctx) => {
  const u = need(ctx, 'class.timeline.manage')
  requireFields(ctx.body, ['title', 'occurredOn'])
  const b = ctx.body as { title: string; summary?: string; body?: string; occurredOn: string; tags?: string[] }
  const t: DbTimeline = {
    id: newId(),
    title: setL(undefined, ctx.lang, b.title),
    summary: setL(undefined, ctx.lang, b.summary ?? ''),
    body: setL(undefined, ctx.lang, b.body ?? ''),
    occurredOn: b.occurredOn,
    tags: b.tags ?? [],
  }
  getDb().timeline.push(t)
  audit(u, 'class.timeline.create', 'timeline', t.id, `Added event ${b.title}`)
  persist()
  return status(201, toTimeline(t, ctx.lang, true))
})
route('PUT', '/admin/class/timeline/:id', (ctx) => {
  const u = need(ctx, 'class.timeline.manage')
  const t = getDb().timeline.find((x) => x.id === ctx.params.id)
  if (!t) throw ApiError.from(404, 'resource.not_found', 'Event not found')
  requireFields(ctx.body, ['title', 'occurredOn'])
  const b = ctx.body as { title: string; summary?: string; body?: string; occurredOn: string; tags?: string[] }
  t.title = setL(t.title, ctx.lang, b.title)
  t.summary = setL(t.summary, ctx.lang, b.summary ?? '')
  t.body = setL(t.body, ctx.lang, b.body ?? '')
  t.occurredOn = b.occurredOn
  t.tags = b.tags ?? []
  audit(u, 'class.timeline.update', 'timeline', t.id, `Updated event ${b.title}`)
  persist()
  return toTimeline(t, ctx.lang, true)
})
route('DELETE', '/admin/class/timeline/:id', (ctx) => {
  const u = need(ctx, 'class.timeline.manage')
  const db = getDb()
  const t = db.timeline.find((x) => x.id === ctx.params.id)
  if (!t) throw ApiError.from(404, 'resource.not_found', 'Event not found')
  db.timeline = db.timeline.filter((x) => x !== t)
  audit(u, 'class.timeline.delete', 'timeline', t.id, `Removed event ${tr(t.title, ctx.lang)}`)
  persist()
  return status(204)
})

/* admin: users, roles, invites */
route('GET', '/admin/users', (ctx) => {
  need(ctx, 'users.read')
  const { role, status: st } = ctx.query
  const list = getDb()
    .users.filter((u) => matches(ctx.query.q, u.username, u.displayName, u.email))
    .filter((u) => !role || u.roles.includes(String(role)))
    .filter((u) => !st || u.status === st)
    .map(toAdminUser)
  return paginate(sortBy(list, ctx.query.sort, '-createdAt'), ctx.query)
})
route('GET', '/admin/users/:id', (ctx) => {
  need(ctx, 'users.read')
  const u = getDb().users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  return toAdminUser(u)
})
route('POST', '/admin/users', (ctx) => {
  const actor = need(ctx, 'users.manage')
  requireFields(ctx.body, ['username', 'displayName'])
  const b = ctx.body as { username: string; displayName: string; password?: string; email?: string; roles?: string[] }
  const db = getDb()
  if (db.users.some((x) => x.username.toLowerCase() === b.username.toLowerCase()))
    throw ApiError.from(409, 'user.already_exists', 'Username taken', { username: ['taken'] })
  const temp = b.password || Math.random().toString(36).slice(2, 10) + 'A1!'
  const u: DbUser = {
    id: newId(),
    username: b.username,
    password: temp,
    displayName: b.displayName,
    email: b.email,
    roles: b.roles?.length ? b.roles : ['Member'],
    status: 'active',
    createdAt: new Date().toISOString(),
    version: 1,
    bio: { zh: '', en: '' },
  }
  db.users.push(u)
  audit(actor, 'user.create', 'user', u.id, `Created user ${u.username}`)
  persist()
  return status(201, { ...toAdminUser(u), temporaryPassword: b.password ? undefined : temp })
})
route('PATCH', '/admin/users/:id', (ctx) => {
  const actor = need(ctx, 'users.manage')
  const u = getDb().users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  const b = ctx.body as { displayName?: string; email?: string; version: number }
  if (b.version !== u.version) throw ApiError.from(409, 'resource.version_mismatch', 'Changed elsewhere')
  const changes = diff({ displayName: u.displayName, email: u.email }, { displayName: b.displayName, email: b.email })
  if (b.displayName !== undefined) u.displayName = b.displayName
  if (b.email !== undefined) u.email = b.email || undefined
  u.version += 1
  audit(actor, 'user.update', 'user', u.id, `Updated user ${u.username}`, changes)
  persist()
  return toAdminUser(u)
})
const setStatus = (to: 'active' | 'disabled'): Handler => (ctx) => {
  const actor = need(ctx, 'users.manage')
  const db = getDb()
  const u = db.users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  if (u.id === actor.id && to === 'disabled') throw ApiError.from(409, 'resource.conflict', 'You cannot disable yourself')
  u.status = to
  u.version += 1
  if (to === 'disabled') db.sessions = db.sessions.filter((s) => s.userId !== u.id)
  audit(actor, to === 'disabled' ? 'user.disable' : 'user.enable', 'user', u.id, `${to === 'disabled' ? 'Disabled' : 'Enabled'} user ${u.username}`)
  persist()
  return toAdminUser(u)
}
route('POST', '/admin/users/:id/disable', setStatus('disabled'))
route('POST', '/admin/users/:id/enable', setStatus('active'))
route('POST', '/admin/users/:id/reset-password', (ctx) => {
  const actor = need(ctx, 'users.manage')
  const db = getDb()
  const u = db.users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  const temp = Math.random().toString(36).slice(2, 10) + 'A1!'
  u.password = temp
  db.sessions = db.sessions.filter((s) => s.userId !== u.id)
  audit(actor, 'user.reset_password', 'user', u.id, `Reset password for ${u.username}`)
  persist()
  return { temporaryPassword: temp }
})
route('PUT', '/admin/users/:id/roles', (ctx) => {
  const actor = need(ctx, 'users.manage')
  const db = getDb()
  const u = db.users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  const ids = (ctx.body?.roleIds ?? []) as string[]
  const names = db.roles.filter((r) => ids.includes(r.id)).map((r) => r.name)
  if (!names.length) throw ApiError.from(400, 'validation.failed', 'At least one role', { roleIds: ['required'] })
  const changes = diff({ roles: u.roles }, { roles: names })
  u.roles = names
  u.version += 1
  audit(actor, 'user.roles', 'user', u.id, `Changed roles of ${u.username}`, changes)
  persist()
  return toAdminUser(u)
})
route('DELETE', '/admin/users/:id', (ctx) => {
  const actor = need(ctx, 'users.manage')
  const db = getDb()
  const u = db.users.find((x) => x.id === ctx.params.id)
  if (!u) throw ApiError.from(404, 'resource.not_found', 'User not found')
  if (u.id === actor.id) throw ApiError.from(409, 'resource.conflict', 'You cannot delete yourself')
  db.users = db.users.filter((x) => x !== u)
  db.sessions = db.sessions.filter((s) => s.userId !== u.id)
  db.members.forEach((m) => {
    if (m.linkedUserId === u.id) m.linkedUserId = undefined
  })
  audit(actor, 'user.delete', 'user', u.id, `Deleted user ${u.username}`)
  persist()
  return status(204)
})

route('GET', '/admin/roles', (ctx) => {
  need(ctx, 'roles.manage')
  return getDb().roles
})
route('GET', '/admin/roles/:id', (ctx) => {
  need(ctx, 'roles.manage')
  const r = getDb().roles.find((x) => x.id === ctx.params.id)
  if (!r) throw ApiError.from(404, 'resource.not_found', 'Role not found')
  return r
})
route('POST', '/admin/roles', (ctx) => {
  const actor = need(ctx, 'roles.manage')
  requireFields(ctx.body, ['name'])
  const b = ctx.body as { name: string; description?: string; permissions?: Permission[] }
  const db = getDb()
  if (db.roles.some((r) => r.name.toLowerCase() === b.name.toLowerCase()))
    throw ApiError.from(409, 'resource.conflict', 'Role exists', { name: ['taken'] })
  const r = { id: newId(), name: b.name, description: b.description ?? '', permissions: b.permissions ?? [], builtIn: false }
  db.roles.push(r)
  audit(actor, 'role.create', 'role', r.id, `Created role ${r.name}`)
  persist()
  return status(201, r)
})
route('PUT', '/admin/roles/:id', (ctx) => {
  const actor = need(ctx, 'roles.manage')
  const r = getDb().roles.find((x) => x.id === ctx.params.id)
  if (!r) throw ApiError.from(404, 'resource.not_found', 'Role not found')
  const b = ctx.body as { name: string; description?: string; permissions: Permission[] }
  if (r.name === 'SuperAdmin') throw ApiError.from(409, 'resource.conflict', 'SuperAdmin cannot be edited')
  const changes = diff({ permissions: r.permissions }, { permissions: b.permissions })
  if (!r.builtIn && b.name) r.name = b.name
  r.description = b.description ?? r.description
  r.permissions = b.permissions
  audit(actor, 'role.update', 'role', r.id, `Updated role ${r.name}`, changes)
  persist()
  return r
})
route('DELETE', '/admin/roles/:id', (ctx) => {
  const actor = need(ctx, 'roles.manage')
  const db = getDb()
  const r = db.roles.find((x) => x.id === ctx.params.id)
  if (!r) throw ApiError.from(404, 'resource.not_found', 'Role not found')
  if (r.builtIn) throw ApiError.from(409, 'resource.conflict', 'Built-in roles cannot be deleted')
  if (db.users.some((u) => u.roles.includes(r.name))) throw ApiError.from(409, 'resource.conflict', 'Role is in use')
  db.roles = db.roles.filter((x) => x !== r)
  audit(actor, 'role.delete', 'role', r.id, `Deleted role ${r.name}`)
  persist()
  return status(204)
})
route('GET', '/admin/permissions', (ctx): PermissionGroup[] => {
  need(ctx, 'roles.manage')
  const mod = (code: Permission) => code.split('.')[0]!
  const groups = new Map<string, PermissionGroup>()
  for (const code of ALL_PERMISSIONS) {
    const m = mod(code)
    if (!groups.has(m)) groups.set(m, { module: m, permissions: [] })
    groups.get(m)!.permissions.push({ code, description: code })
  }
  return [...groups.values()]
})

route('GET', '/admin/invites', (ctx) => {
  need(ctx, 'invites.manage')
  return paginate(sortBy(getDb().invites, '-createdAt'), ctx.query)
})
route('POST', '/admin/invites', (ctx) => {
  const actor = need(ctx, 'invites.manage')
  const b = ctx.body as { role?: string; maxUses?: number; expiresAt?: string; code?: string }
  const code = (b.code?.trim() || Math.random().toString(36).slice(2, 8).toUpperCase()) as string
  const db = getDb()
  if (db.invites.some((i) => i.code === code)) throw ApiError.from(409, 'resource.conflict', 'Code exists', { code: ['taken'] })
  const inv = {
    id: newId(),
    code,
    role: b.role || 'Member',
    maxUses: Math.max(1, Number(b.maxUses ?? 1)),
    usedCount: 0,
    expiresAt: b.expiresAt || undefined,
    createdAt: new Date().toISOString(),
  }
  db.invites.push(inv)
  audit(actor, 'invite.create', 'invite', inv.id, `Created invite ${code}`)
  persist()
  return status(201, inv)
})
route('DELETE', '/admin/invites/:id', (ctx) => {
  const actor = need(ctx, 'invites.manage')
  const db = getDb()
  const i = db.invites.find((x) => x.id === ctx.params.id)
  if (!i) throw ApiError.from(404, 'resource.not_found', 'Invite not found')
  db.invites = db.invites.filter((x) => x !== i)
  audit(actor, 'invite.delete', 'invite', i.id, `Deleted invite ${i.code}`)
  persist()
  return status(204)
})

/* admin: settings, audit, system */
const GROUPS: SettingsGroupKey[] = ['site', 'appearance', 'security', 'storage', 'speech']
const envelope = <K extends SettingsGroupKey>(g: K): SettingsEnvelope<K> => {
  const s = getDb().settings
  return { group: g, values: s[g] as SettingsEnvelope<K>['values'], version: s.versions[g] }
}
route('GET', '/admin/settings', (ctx) => {
  need(ctx, 'site.settings.read')
  return GROUPS.map(envelope)
})
route('GET', '/admin/settings/:group', (ctx) => {
  need(ctx, 'site.settings.read')
  const g = ctx.params.group as SettingsGroupKey
  if (!GROUPS.includes(g)) throw ApiError.from(404, 'resource.not_found', 'Unknown settings group')
  return envelope(g)
})
route('PUT', '/admin/settings/:group', (ctx) => {
  const actor = need(ctx, 'site.settings.write')
  const g = ctx.params.group as SettingsGroupKey
  if (!GROUPS.includes(g)) throw ApiError.from(404, 'resource.not_found', 'Unknown settings group')
  const s = getDb().settings
  const b = ctx.body as { values: Record<string, unknown>; version: number }
  if (b.version !== s.versions[g]) throw ApiError.from(409, 'resource.version_mismatch', 'Settings changed elsewhere')
  const before = s[g] as unknown as Record<string, unknown>
  const merged = { ...before, ...b.values }
  if (g === 'site') requireFields(merged, ['className'])
  if (g === 'speech') validateSpeechSettings(merged as unknown as SpeechSettings)
  const changes = diff(before, b.values)
  ;(s as unknown as Record<string, unknown>)[g] = merged
  s.versions[g] += 1
  audit(actor, 'settings.update', 'settings', g, `Updated ${g} settings`, changes)
  persist()
  return envelope(g)
})
route('GET', '/admin/audit-logs', (ctx) => {
  need(ctx, 'audit.read')
  const { actor, action, resourceType, from, to } = ctx.query
  const list = getDb()
    .audit.filter((a) => !actor || a.actor.toLowerCase().includes(String(actor).toLowerCase()))
    .filter((a) => !action || a.action.includes(String(action)))
    .filter((a) => !resourceType || a.resourceType === resourceType)
    .filter((a) => !from || a.at >= String(from))
    .filter((a) => !to || a.at <= String(to) + 'T23:59:59.999Z')
  return paginate(list, ctx.query)
})
route('GET', '/admin/audit-logs/:id', (ctx) => {
  need(ctx, 'audit.read')
  const a = getDb().audit.find((x) => x.id === ctx.params.id)
  if (!a) throw ApiError.from(404, 'resource.not_found', 'Log not found')
  return a
})
const startedAt = Date.now()
route('GET', '/admin/system/status', (ctx): SystemStatus => {
  need(ctx, 'system.read')
  return {
    version: '0.1.0-mock',
    runtime: 'Mock transport (no backend)',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    database: { provider: 'Postgres', healthy: true, migrationVersion: '—' },
    mongo: { enabled: false, healthy: false },
    redis: { enabled: false, healthy: false },
  }
})
route('POST', '/admin/system/cache/clear', (ctx) => {
  const actor = need(ctx, 'system.manage')
  audit(actor, 'system.cache.clear', 'system', undefined, 'Cleared cache')
  persist()
  return status(204)
})

/* speech queue + first-run wizard live in their own files; they get the shared helpers here */
const kit = { route, status, currentUser, need, audit, paginate, rolePermissions }
registerSpeechRoutes(kit)
registerPluginRoutes(kit)
registerTimetableRoutes(kit)
registerSetupRoutes({ ...kit, authResult, openSession: (u) => void openSession(u) })

/* ----------------------------- dispatch ----------------------------- */

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/')
  const b = path.split('/')
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(b[i]!)
    else if (seg !== b[i]) return null
  }
  return params
}

export async function dispatch(
  method: string,
  path: string,
  query: Ctx['query'],
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const lang: Lang = (headers['Accept-Language'] ?? 'zh').startsWith('en') ? 'en' : 'zh'
  // like the real backend: until setup has produced a database and an admin, only /setup/** answers
  if (!path.startsWith('/setup/') && getDb().setup.state !== 'ready')
    return { status: 503, body: { status: 503, code: 'setup.required', title: 'Setup required' } }
  if ((path === '/speech' || path.startsWith('/speech/') || path === '/admin/speech' || path.startsWith('/admin/speech/')) && !isPluginEnabled('meetings'))
    return { status: 404, body: { status: 404, code: 'resource.not_found', title: 'Plugin unavailable' } }
  for (const [m, p, h] of routes) {
    if (m !== method) continue
    const params = match(p, path)
    if (!params) continue
    try {
      const out = await h({ params, query, body, headers, lang })
      if (isStatus(out)) return { status: out.__status, body: out.body }
      return { status: 200, body: out }
    } catch (e) {
      if (e instanceof ApiError) {
        return {
          status: e.status,
          body: { status: e.status, code: e.code, title: e.message, detail: e.message, errors: e.errors, traceId: newId() },
        }
      }
      return { status: 500, body: { status: 500, code: 'server.error', title: String(e) } }
    }
  }
  return { status: 404, body: { status: 404, code: 'resource.not_found', title: `No route ${method} ${path}` } }
}
