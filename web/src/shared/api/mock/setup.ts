/**
 * Mock of the first-run wizard (contract §S3). The DB flag `setup` decides what `GET /setup/status`
 * says: seeded as `ready` + completed (so the demo opens normally). `replaySetup()` puts it back to
 * `needs_database` so `/setup?demo=1` can walk the whole wizard again.
 */
import { ApiError } from '../errors'
import type { DatabaseInput, DatabaseTestResult, SetupAdminInput, SetupStatus } from '../types'
import { getDb, newId, persist, type DbUser } from './db'
import type { Ctx, Handler } from './handlers'
import type { Kit } from './speech'

const PROVIDERS = ['PostgreSql', 'MySql', 'Sqlite']

export function replaySetup() {
  const s = getDb().setup
  s.state = 'needs_database'
  s.completed = false
  persist()
}

export function registerSetupRoutes(k: Kit & { authResult: (u: DbUser, lang: Ctx['lang']) => unknown; openSession: (u: DbUser) => void }) {
  const { route, status } = k
  const setup = () => getDb().setup

  const snapshot = (): SetupStatus => {
    const s = setup()
    return {
      state: s.state,
      setupCompleted: s.completed,
      tokenRequired: s.state !== 'ready',
      database: {
        provider: 'Sqlite',
        configured: s.state !== 'needs_database',
        connected: s.state !== 'needs_database',
      },
      storage: { path: 'data/storage (mock)', writable: true },
      converter: { available: false },
      jwtKeyIsDefault: s.state === 'needs_database',
      environment: 'Mock',
      version: '0.1.0-mock',
    }
  }
  const guard = (ctx: Ctx, state: 'needs_database' | 'needs_admin') => {
    const s = setup()
    if (s.completed || s.state !== state) throw ApiError.from(403, 'setup.forbidden', 'Setup is already complete')
    if (ctx.headers['X-Setup-Token'] !== s.token) throw ApiError.from(403, 'setup.forbidden', 'Wrong setup token')
  }
  const validateDb = (b: DatabaseInput | undefined): DatabaseTestResult => {
    if (!b || !PROVIDERS.includes(b.provider) || !String(b.connectionString ?? '').trim())
      throw ApiError.from(400, 'validation.failed', 'Validation failed', { connectionString: ['required'] })
    if (/unreachable|refused|nope/i.test(b.connectionString))
      throw ApiError.from(422, 'setup.database_unreachable', 'Could not connect to the database')
    return { ok: true, message: 'Connected (mock)', serverVersion: b.provider === 'Sqlite' ? 'SQLite 3.45' : `${b.provider} 16.2` }
  }

  route('GET', '/setup/status', () => snapshot())

  route('POST', '/setup/database/test', (ctx) => {
    guard(ctx, 'needs_database')
    return validateDb(ctx.body as DatabaseInput)
  })

  route('POST', '/setup/database', (ctx) => {
    guard(ctx, 'needs_database')
    validateDb(ctx.body as DatabaseInput)
    setup().state = 'needs_admin'
    persist()
    return snapshot()
  })

  route('POST', '/setup/admin', ((ctx) => {
    guard(ctx, 'needs_admin')
    const b = (ctx.body ?? {}) as Partial<SetupAdminInput>
    const errors: Record<string, string[]> = {}
    if (!b.username?.trim()) errors.username = ['required']
    if (!b.displayName?.trim()) errors.displayName = ['required']
    if (!b.password) errors.password = ['required']
    else if (b.password.length < getDb().settings.security.minPasswordLength) errors.password = ['too_short']
    if (Object.keys(errors).length) throw ApiError.from(400, 'validation.failed', 'Validation failed', errors)
    const db = getDb()
    if (db.users.some((u) => u.username.toLowerCase() === b.username!.trim().toLowerCase()))
      throw ApiError.from(409, 'user.already_exists', 'Username taken', { username: ['taken'] })
    const u: DbUser = {
      id: newId(),
      username: b.username!.trim(),
      password: b.password!,
      displayName: b.displayName!.trim(),
      email: b.email || undefined,
      roles: ['SuperAdmin'],
      status: 'active',
      createdAt: new Date().toISOString(),
      version: 1,
      bio: { zh: '', en: '' },
    }
    db.users.push(u)
    setup().state = 'ready'
    k.openSession(u)
    persist()
    return k.authResult(u, ctx.lang)
  }) as Handler)

  route('POST', '/setup/complete', (ctx) => {
    const u = k.currentUser(ctx)
    if (setup().completed) throw ApiError.from(403, 'setup.forbidden', 'Setup is already complete')
    if (!u.roles.includes('SuperAdmin')) throw ApiError.from(403, 'permission.denied', 'Permission denied')
    setup().completed = true
    persist()
    return status(204)
  })
}
