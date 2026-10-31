import { beforeEach, describe, expect, it } from 'vitest'
import { api, adminApi, authApi, classApi, isApiError, siteApi } from '..'
import { mockTransport } from './transport'
import { resetDb } from './db'
import { currentLang } from '@/shared/i18n'

beforeEach(() => {
  localStorage.clear()
  resetDb()
  api.setTransport(mockTransport(0))
  api.setAccessToken(null)
  api.setRefresher(async () => null, () => {})
})

const asAdmin = async () => {
  const r = await authApi.login({ account: 'admin', password: 'Admin123!' })
  api.setAccessToken(r.accessToken)
  return r
}

describe('mock API follows docs/api-contract.md', () => {
  it('serves public site info anonymously', async () => {
    const s = await siteApi.public()
    expect(s.className).toBeTruthy()
    expect(s.registrationMode).toBe('invite')
    expect(s.features).toEqual({ mongo: false, redis: false })
  })

  it('returns class overview with the contract shape', async () => {
    const o = await classApi.overview()
    expect(o.membersPreview.length).toBeLessThanOrEqual(12)
    expect(o.latestTimeline.length).toBeLessThanOrEqual(5)
    expect(o.stats.memberCount).toBeGreaterThan(0)
  })

  it('paginates with { items, total, page, pageSize }', async () => {
    const p = await classApi.members({ page: 2, pageSize: 5 })
    expect(p.page).toBe(2)
    expect(p.pageSize).toBe(5)
    expect(p.items).toHaveLength(5)
    expect(p.total).toBeGreaterThan(10)
  })

  it('rejects bad credentials with a machine-readable code', async () => {
    const err = await authApi.login({ account: 'admin', password: 'nope' }).catch((e) => e)
    expect(isApiError(err)).toBe(true)
    expect(err.status).toBe(401)
    expect(err.code).toBe('auth.invalid_credentials')
  })

  it('locks an account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await authApi.login({ account: 'locky', password: 'x' }).catch(() => {})
    const err = await authApi.login({ account: 'locky', password: 'x' }).catch((e) => e)
    expect(err.status).toBe(423)
    expect(err.code).toBe('auth.account_locked')
  })

  it('gates admin endpoints by permission', async () => {
    const anon = await adminApi.users().catch((e) => e)
    expect(anon.status).toBe(401)
    const r = await authApi.login({ account: 'student', password: 'Student123!' })
    api.setAccessToken(r.accessToken)
    const denied = await adminApi.users().catch((e) => e)
    expect(denied.status).toBe(403)
    expect(denied.code).toBe('permission.denied')
  })

  it('refreshes the session from the stored refresh token and rotates it', async () => {
    await authApi.login({ account: 'admin', password: 'Admin123!' })
    const before = localStorage.getItem('classight.mock.rt')
    const r = await authApi.refresh()
    expect(r.accessToken).toBeTruthy()
    expect(localStorage.getItem('classight.mock.rt')).not.toBe(before)
  })

  it('enforces optimistic concurrency on settings', async () => {
    await asAdmin()
    const g = await adminApi.settingsGroup('site')
    await adminApi.saveSettings('site', { slogan: 'new' }, g.version)
    const stale = await adminApi.saveSettings('site', { slogan: 'again' }, g.version).catch((e) => e)
    expect(stale.status).toBe(409)
    expect(stale.code).toBe('resource.version_mismatch')
  })

  it('writes an audit entry with field-level changes', async () => {
    await asAdmin()
    const g = await adminApi.settingsGroup('site')
    await adminApi.saveSettings('site', { slogan: 'changed' }, g.version)
    const logs = await adminApi.auditLogs({ action: 'settings.update' })
    const entry = logs.items[0]!
    const detail = await adminApi.auditLog(entry.id)
    expect(detail.changes?.some((c) => c.field === 'slogan' && c.after === 'changed')).toBe(true)
  })

  it('refuses to delete built-in roles and to disable yourself', async () => {
    const me = await asAdmin()
    const roles = await adminApi.roles()
    const builtIn = roles.find((r) => r.builtIn)!
    const e1 = await adminApi.deleteRole(builtIn.id).catch((e) => e)
    expect(e1.status).toBe(409)
    const e2 = await adminApi.disableUser(me.user.id).catch((e) => e)
    expect(e2.status).toBe(409)
  })

  it('registration consumes an invite and rejects reuse beyond maxUses', async () => {
    await asAdmin()
    const inv = await adminApi.createInvite({ code: 'ONCE', maxUses: 1 })
    expect(inv.usedCount).toBe(0)
    api.setAccessToken(null)
    await authApi.register({ inviteCode: 'ONCE', username: 'newbie', displayName: 'N', password: 'longenough1' })
    const again = await authApi.register({ inviteCode: 'ONCE', username: 'second', displayName: 'S', password: 'longenough1' }).catch((e) => e)
    expect(again.code).toBe('invite.invalid')
  })

  it('localizes content by Accept-Language', async () => {
    api.setLanguage('en')
    const en = await classApi.profile()
    api.setLanguage('zh')
    const zh = await classApi.profile()
    expect(en.motto).not.toBe(zh.motto)
    void currentLang
  })
})
