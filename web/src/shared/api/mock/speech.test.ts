import { beforeEach, describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { adminApi, api, authApi, setupApi, speechApi } from '..'
import { mockTransport } from './transport'
import { resetDb } from './db'

beforeEach(() => {
  localStorage.clear()
  resetDb()
  api.setTransport(mockTransport(0))
  api.setAccessToken(null)
  api.setRefresher(async () => null, () => {})
})

const as = async (account: string, password: string) => {
  const r = await authApi.login({ account, password })
  api.setAccessToken(r.accessToken)
  return r.user
}
const student = () => as('student', 'Student123!')
const admin = () => as('admin', 'Admin123!')

const sessionByStatus = async (status: 'open' | 'running' | 'closed') => {
  const page = await speechApi.sessions({ pageSize: 50 })
  return page.items.find((x) => x.status === status)!
}

const detail = (id: string) => speechApi.session(id)
const err = (p: Promise<unknown>) => p.then(() => null, (e) => e as { status: number; code: string })

const file = (name: string, bytes: Uint8Array | string, type = 'application/octet-stream') =>
  new File([typeof bytes === 'string' ? strToU8(bytes) : (bytes as Uint8Array<ArrayBuffer>)], name, { type })
const pptx = () => file('deck.pptx', zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/presentation.xml': strToU8('<p/>') }))
const site = (withIndex = true) =>
  file('site.zip', zipSync(withIndex ? { 'index.html': strToU8('<h1>hi</h1><script src="a.js"></script>'), 'a.js': strToU8('1') } : { 'readme.txt': strToU8('x') }))
const noop = () => {}

describe('speech sessions', () => {
  it('requires login to read and hides drafts from non-managers', async () => {
    expect((await err(speechApi.sessions()))?.status).toBe(401)
    await student()
    const page = await speechApi.sessions({ pageSize: 50 })
    expect(page.items.some((s) => s.status === 'draft')).toBe(false)
    expect(page.items.map((s) => s.date)).toEqual([...page.items.map((s) => s.date)].sort().reverse())
    await admin()
    const all = await speechApi.adminSessions({ pageSize: 50 })
    const draft = all.items.find((s) => s.status === 'draft')!
    expect(draft).toBeTruthy()
    await student()
    expect((await err(detail(draft.id)))?.status).toBe(404)
    expect((await err(speechApi.adminSessions()))?.code).toBe('permission.denied')
  })

  it('returns detail with ordered entries, mine flags and join codes only for members', async () => {
    await student()
    const open = await sessionByStatus('open')
    const d = await detail(open.id)
    expect(d.entries.map((e) => e.position)).toEqual(d.entries.map((_, i) => i + 1))
    expect(d.myEntryId).toBeUndefined()
    expect(d.teams.every((t) => t.joinCode === undefined)).toBe(true)
    await admin()
    const dm = await detail(open.id)
    expect(dm.teams.every((t) => !!t.joinCode)).toBe(true)
  })
})

describe('sign-up rules', () => {
  it('allows one entry per user per session', async () => {
    await student()
    const open = await sessionByStatus('open')
    const e = await speechApi.signUp(open.id, { topic: '我的题目' })
    expect(e.mine).toBe(true)
    expect(e.position).toBe((await detail(open.id)).entries.length)
    expect((await err(speechApi.signUp(open.id, { topic: '再来一个' })))?.code).toBe('speech.already_signed_up')
    expect((await detail(open.id)).myEntryId).toBe(e.id)
  })

  it('validates the topic and refuses closed sessions', async () => {
    await student()
    const open = await sessionByStatus('open')
    const bad = await err(speechApi.signUp(open.id, { topic: '  ' }))
    expect(bad?.status).toBe(400)
    const running = await sessionByStatus('running')
    expect((await err(speechApi.signUp(running.id, { topic: 'x' })))?.code).toBe('speech.closed')
  })

  it('lets the owner edit (with version) and cancel, keeping positions consecutive', async () => {
    await student()
    const open = await sessionByStatus('open')
    const e = await speechApi.signUp(open.id, { topic: 'a' })
    const edited = await speechApi.updateEntry(e.id, { topic: 'b', version: e.version })
    expect(edited.topic).toBe('b')
    expect((await err(speechApi.updateEntry(e.id, { topic: 'c', version: e.version })))?.code).toBe('resource.version_mismatch')
    await speechApi.deleteEntry(e.id)
    const d = await detail(open.id)
    expect(d.entries.map((x) => x.position)).toEqual(d.entries.map((_, i) => i + 1))
    expect(d.entries.some((x) => x.id === e.id)).toBe(false)
  })
})

describe('teams', () => {
  it('creates a team, signs it up, and blocks a second team or solo entry', async () => {
    await student()
    const open = await sessionByStatus('open')
    const t = await speechApi.createTeam(open.id, { name: '夜读组' })
    expect(t.joinCode).toBeTruthy()
    expect(t.members).toHaveLength(1)
    expect((await err(speechApi.createTeam(open.id, { name: '又一支' })))?.code).toBe('speech.team_exists')
    expect((await err(speechApi.signUp(open.id, { topic: 'solo' })))?.code).toBe('speech.team_exists')
    const e = await speechApi.signUp(open.id, { topic: '读书', teamId: t.id })
    expect(e.team?.id).toBe(t.id)
    expect((await detail(open.id)).myTeamId).toBe(t.id)
    expect((await err(speechApi.signUp(open.id, { topic: '读书2', teamId: t.id })))?.code).toBe('speech.already_signed_up')
  })

  it('joins by code, enforces size, and shares the entry', async () => {
    await student()
    const open = await sessionByStatus('open')
    const before = (await detail(open.id)).teams[0]!
    const joined = await speechApi.joinTeam({ code: 'demo-book' }) // codes are case-insensitive
    expect(joined.mine).toBe(true)
    expect(joined.members.length).toBe(before.members.length + 1)
    const d = await detail(open.id)
    expect(d.myEntryId).toBeTruthy()
    expect((await err(speechApi.joinTeam({ code: 'NOPE' })))?.status).toBe(404)
    expect((await err(speechApi.joinTeam({ code: 'DEMO-BOOK' })))?.code).toBe('speech.team_exists')
  })

  it('reports team_full when the limit is reached', async () => {
    await admin()
    const created = await adminApi.settingsGroup('speech')
    await adminApi.saveSettings('speech', { maxTeamSize: 2 }, created.version)
    const s = await speechApi.createSession({ title: 't', date: '2030-01-01' })
    await speechApi.setStatus(s.id, 'open')
    await student()
    const team = await speechApi.createTeam(s.id, { name: 'x' })
    await as('sunian', 'Student123!')
    await speechApi.joinTeam({ code: team.joinCode! })
    await as('zhoukexin', 'Student123!')
    expect((await err(speechApi.joinTeam({ code: team.joinCode! })))?.code).toBe('speech.team_full')
  })

  it('leader cannot leave, others can; leader can kick; disband removes the entry', async () => {
    await admin()
    const fresh = await speechApi.createSession({ title: 'fresh', date: '2031-01-01' })
    await speechApi.setStatus(fresh.id, 'open')
    const me = await student().then((u) => u.id)
    const t2 = await speechApi.createTeam(fresh.id, { name: '新队' })
    await as('hezhiruo', 'Student123!')
    await speechApi.joinTeam({ code: t2.joinCode! })
    const hezhiruo = (await authApi.me()).id
    await speechApi.removeMember(t2.id, hezhiruo) // leaves on her own
    await speechApi.joinTeam({ code: t2.joinCode! })
    await student()
    expect((await err(speechApi.removeMember(t2.id, me)))?.code).toBe('resource.conflict')
    await speechApi.removeMember(t2.id, hezhiruo) // leader kicks
    await as('hezhiruo', 'Student123!')
    expect((await err(speechApi.disbandTeam(t2.id)))?.code).toBe('speech.not_leader')
    await student()
    await speechApi.signUp(fresh.id, { topic: 'x', teamId: t2.id })
    await speechApi.disbandTeam(t2.id)
    const d = await detail(fresh.id)
    expect(d.entries).toHaveLength(0)
    expect(d.teams).toHaveLength(0)
  })

  it('refuses teams when the session disallows them', async () => {
    await admin()
    const s = await speechApi.createSession({ title: 'solo only', date: '2030-02-02', allowTeams: false })
    await speechApi.setStatus(s.id, 'open')
    await student()
    expect((await err(speechApi.createTeam(s.id, { name: 'x' })))?.code).toBe('speech.teams_disabled')
  })
})

describe('admin run console', () => {
  it('enforces the status flow', async () => {
    await admin()
    const s = await speechApi.createSession({ title: 'flow', date: '2030-03-03' })
    expect(s.status).toBe('draft')
    expect((await err(speechApi.setStatus(s.id, 'running')))?.code).toBe('resource.conflict')
    await speechApi.setStatus(s.id, 'open')
    await speechApi.setStatus(s.id, 'running')
    await speechApi.setStatus(s.id, 'open')
    await speechApi.setStatus(s.id, 'running')
    await speechApi.setStatus(s.id, 'closed')
    expect((await speechApi.setStatus(s.id, 'open')).status).toBe('open')
  })

  it('allows a single speaker and moves entries through start / finish / skip', async () => {
    await admin()
    const running = await sessionByStatus('running')
    const d = await detail(running.id)
    const queued = d.entries.filter((e) => e.status === 'queued')
    expect((await err(speechApi.startEntry(queued[0]!.id)))?.code).toBe('speech.speaking_exists')
    const speaking = d.entries.find((e) => e.status === 'speaking')!
    await speechApi.finishEntry(speaking.id)
    const started = await speechApi.startEntry(queued[0]!.id)
    expect(started.status).toBe('speaking')
    expect((await detail(running.id)).currentEntryId).toBe(queued[0]!.id)
    const skipped = await speechApi.skipEntry(queued[1]!.id)
    expect(skipped.status).toBe('skipped')
    expect((await err(speechApi.finishEntry(queued[1]!.id)))?.code).toBe('resource.conflict')
  })

  it('reorders only with exactly the queued entries and leaves finished ones in place', async () => {
    await admin()
    const running = await sessionByStatus('running')
    const d = await detail(running.id)
    const queued = d.entries.filter((e) => e.status === 'queued').map((e) => e.id)
    expect((await err(speechApi.setOrder(running.id, queued.slice(1))))?.status).toBe(400)
    const reversed = [...queued].reverse()
    const after = await speechApi.setOrder(running.id, reversed)
    expect(after.entries.filter((e) => e.status === 'queued').map((e) => e.id)).toEqual(reversed)
    expect(after.entries.map((e) => e.position)).toEqual(after.entries.map((_, i) => i + 1))
    expect(after.entries.filter((e) => e.status !== 'queued').map((e) => e.position)).toEqual(
      d.entries.filter((e) => e.status !== 'queued').map((e) => e.position),
    )
  })

  it('signs a user up on their behalf and validates session input', async () => {
    await admin()
    const open = await sessionByStatus('open')
    const users = await adminApi.users({ pageSize: 50 })
    const target = users.items.find((u) => u.username === 'student')!
    const e = await speechApi.signUpFor(open.id, { topic: '代报名', ownerId: target.id })
    expect(e.owner.id).toBe(target.id)
    expect((await err(speechApi.signUpFor(open.id, { topic: 'again', ownerId: target.id })))?.code).toBe('speech.already_signed_up')
    const bad = await err(speechApi.createSession({ title: '', date: 'tomorrow' }))
    expect(bad?.status).toBe(400)
    const mine = await speechApi.createSession({ title: 'ok', date: '2030-05-05' })
    expect(mine.slotMinutes).toBe(5) // from the speech settings group
    await speechApi.deleteSession(mine.id)
    expect((await err(detail(mine.id)))?.status).toBe(404)
  })

  it('keeps the speech settings group within range', async () => {
    await admin()
    const g = await adminApi.settingsGroup('speech')
    expect(g.values.maxCoursewareMb).toBe(50)
    const bad = await err(adminApi.saveSettings('speech', { maxTeamSize: 1 }, g.version))
    expect(bad?.status).toBe(400)
    const ok = await adminApi.saveSettings('speech', { maxTeamSize: 6 }, g.version)
    expect(ok.values.maxTeamSize).toBe(6)
  })
})

describe('courseware', () => {
  const mineEntry = async () => {
    await student()
    const open = await sessionByStatus('open')
    return speechApi.signUp(open.id, { topic: 'with slides' })
  }

  it('rejects unknown types, wrong magic numbers, oversize files and zips without index.html', async () => {
    const e = await mineEntry()
    expect((await err(speechApi.uploadCourseware(e.id, file('a.exe', 'MZ'), noop)))?.code).toBe('courseware.unsupported_type')
    expect((await err(speechApi.uploadCourseware(e.id, file('a.pdf', 'not a pdf'), noop)))?.code).toBe('courseware.unsupported_type')
    expect((await err(speechApi.uploadCourseware(e.id, file('a.pptx', zipSync({ 'x.txt': strToU8('x') })), noop)))?.code).toBe('courseware.unsupported_type')
    expect((await err(speechApi.uploadCourseware(e.id, site(false), noop)))?.code).toBe('courseware.invalid_archive')
    await admin()
    const g = await adminApi.settingsGroup('speech')
    await adminApi.saveSettings('speech', { maxCoursewareMb: 1 }, g.version)
    await student()
    const big = file('big.pdf', new Uint8Array(1024 * 1024 + 1).fill(0x20))
    expect((await err(speechApi.uploadCourseware(e.id, big, noop)))?.code).toBe('courseware.too_large')
  })

  it('uploads with progress, replaces the previous file, and previews it', async () => {
    const e = await mineEntry()
    const seen: number[] = []
    const first = await speechApi.uploadCourseware(e.id, pptx(), (l, t) => seen.push(l / t))
    expect(seen.at(-1)).toBe(1)
    expect(first.kind).toBe('pptx')
    expect(first.previewMode).toBe('pptx')
    const second = await speechApi.uploadCourseware(e.id, file('x.pdf', '%PDF-1.4 hi'), noop)
    expect((await err(speechApi.courseware(first.id)))?.status).toBe(404)
    expect(second.previewMode).toBe('pdf')
    const d = await detail(e.sessionId)
    expect(d.entries.find((x) => x.id === e.id)?.courseware?.id).toBe(second.id)
    const ticket = await speechApi.previewTicket(second.id)
    expect(ticket.mode).toBe('pdf')
    expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now())
    const blob = await speechApi.downloadCourseware(second.id)
    expect(blob.size).toBe(second.size)
  })

  it('accepts a web project zip and offers the web preview mode', async () => {
    const e = await mineEntry()
    const cw = await speechApi.uploadCourseware(e.id, site(), noop)
    expect(cw.kind).toBe('web')
    expect(cw.previewMode).toBe('web')
    const ticket = await speechApi.previewTicket(cw.id)
    expect(ticket.mode).toBe('web')
  })

  it('does not let strangers touch someone else’s entry, but managers can', async () => {
    const e = await mineEntry()
    await as('sunian', 'Student123!')
    expect((await err(speechApi.uploadCourseware(e.id, pptx(), noop)))?.code).toBe('permission.denied')
    expect((await err(speechApi.deleteEntry(e.id)))?.code).toBe('permission.denied')
    await admin()
    const cw = await speechApi.uploadCourseware(e.id, pptx(), noop)
    await speechApi.deleteCourseware(cw.id)
    expect((await err(speechApi.courseware(cw.id)))?.status).toBe(404)
  })

  it('keeps metadata but not the bytes of seeded decks: preview says the file is gone', async () => {
    await student()
    const running = await sessionByStatus('running')
    const d = await detail(running.id)
    const seeded = d.entries.find((x) => x.courseware)!.courseware!
    const gone = await err(speechApi.previewTicket(seeded.id))
    expect(gone?.status).toBe(404)
    expect(gone?.code).toBe('courseware.file_missing')
  })
})

describe('setup wizard mock', () => {
  it('is ready and completed by default and locks setup writes', async () => {
    const s = await setupApi.status()
    expect(s.state).toBe('ready')
    expect(s.setupCompleted).toBe(true)
    expect((await err(setupApi.testDatabase({ provider: 'Sqlite', connectionString: 'Data Source=x.db' }, 'demo-setup')))?.code).toBe('setup.forbidden')
  })

  it('walks database -> admin -> complete when replayed', async () => {
    const { replaySetup } = await import('./setup')
    replaySetup()
    expect((await setupApi.status()).state).toBe('needs_database')
    expect((await err(authApi.login({ account: 'admin', password: 'x' })))?.code).toBe('setup.required')
    const input = { provider: 'Sqlite' as const, connectionString: 'Data Source=classight.db' }
    expect((await err(setupApi.testDatabase(input)))?.code).toBe('setup.forbidden') // token required
    expect((await err(setupApi.testDatabase({ ...input, connectionString: 'host=unreachable' }, 'demo-setup')))?.code).toBe('setup.database_unreachable')
    expect((await setupApi.testDatabase(input, 'demo-setup')).ok).toBe(true)
    expect((await setupApi.applyDatabase(input, 'demo-setup')).state).toBe('needs_admin')
    const r = await setupApi.createAdmin({ username: 'owner', displayName: 'Owner', password: 'longenough1' }, 'demo-setup')
    api.setAccessToken(r.accessToken)
    expect(r.user.roles).toContain('SuperAdmin')
    expect((await setupApi.status()).setupCompleted).toBe(false)
    await setupApi.complete()
    expect((await setupApi.status()).setupCompleted).toBe(true)
  })
})
