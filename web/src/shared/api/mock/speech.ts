/**
 * Mock handlers for the class-meeting queue (docs/api-contract-speech-setup.md §S1).
 * Same status codes, error codes and rules as the contract; registered from handlers.ts.
 */
import { ApiError } from '../errors'
import type {
  Capabilities,
  AssignedTeamInput,
  Courseware,
  PersonRef,
  Permission,
  SpeechEntry,
  SpeechSession,
  SpeechSessionDetail,
  SpeechSessionStatus,
  SpeechSettings,
  SpeechTeam,
  TeamMember,
} from '../types'
import { findWebIndex, kindFromName, readBytes, zipEntryNames } from '../../courseware'
import { getDb, newId, persist, type DbCourseware, type DbSpeechEntry, type DbSpeechSession, type DbSpeechTeam, type DbUser } from './db'
import { dropFile, getFile, putFile } from './files'
import type { Ctx, Handler } from './handlers'

export interface Kit {
  route: (method: string, path: string, h: Handler) => void
  status: (code: number, body?: unknown) => unknown
  currentUser: (ctx: Ctx) => DbUser
  need: (ctx: Ctx, ...perms: Permission[]) => DbUser
  audit: (actor: DbUser, action: string, resourceType: string, resourceId: string | undefined, summary: string) => void
  paginate: <T>(items: T[], q: Ctx['query']) => { items: T[]; total: number; page: number; pageSize: number }
  rolePermissions: (roles: string[]) => Permission[]
}

const TRANSITIONS: Record<SpeechSessionStatus, SpeechSessionStatus[]> = {
  draft: ['open'],
  open: ['running'],
  running: ['open', 'closed'],
  closed: ['open'],
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validateSpeechSettings(v: SpeechSettings) {
  const errors: Record<string, string[]> = {}
  if (!(v.defaultSlotMinutes >= 1 && v.defaultSlotMinutes <= 60)) errors.defaultSlotMinutes = ['out_of_range']
  if (!(v.maxTeamSize >= 2 && v.maxTeamSize <= 20)) errors.maxTeamSize = ['out_of_range']
  if (!(v.maxCoursewareMb >= 1 && v.maxCoursewareMb <= 200)) errors.maxCoursewareMb = ['out_of_range']
  if (Object.keys(errors).length) throw ApiError.from(400, 'validation.failed', 'Validation failed', errors)
}

export function registerSpeechRoutes(k: Kit) {
  const { route, status, currentUser, need, audit, paginate } = k
  const sp = () => getDb().speech
  const isManage = (u: DbUser) => k.rolePermissions(u.roles).includes('speech.manage')

  /* ------------------------------ mappers ------------------------------ */
  const person = (userId: string): PersonRef => {
    const u = getDb().users.find((x) => x.id === userId)
    return { id: userId, displayName: u?.displayName ?? '—', avatarUrl: u?.avatarUrl }
  }
  const members = (t: DbSpeechTeam): TeamMember[] =>
    t.memberIds.map((id) => ({ ...person(id), userId: id, isLeader: id === t.leaderId })).map(({ id: _id, ...m }) => m)

  const toCourseware = (c: DbCourseware): Courseware => {
    // no converter in the mock: pptx renders in the browser, ppt can only be downloaded
    const previewMode: Courseware['previewMode'] = c.kind === 'pdf' ? 'pdf' : c.kind === 'web' ? 'web' : c.kind === 'pptx' ? 'pptx' : 'none'
    return {
      id: c.id,
      entryId: c.entryId,
      kind: c.kind,
      originalName: c.originalName,
      size: c.size,
      conversion: c.conversion,
      previewMode,
      uploadedAt: c.uploadedAt,
      uploader: person(c.uploaderId),
    }
  }
  const mineEntry = (e: DbSpeechEntry, me: DbUser) => {
    const t = e.teamId ? sp().teams.find((x) => x.id === e.teamId) : undefined
    return e.ownerId === me.id || !!t?.memberIds.includes(me.id)
  }
  const toEntry = (e: DbSpeechEntry, me: DbUser): SpeechEntry => {
    const t = e.teamId ? sp().teams.find((x) => x.id === e.teamId) : undefined
    const cw = sp().courseware.find((c) => c.entryId === e.id)
    return {
      id: e.id,
      sessionId: e.sessionId,
      position: isManage(me) ? e.position : 1,
      topic: e.topic,
      status: e.status,
      owner: person(e.ownerId),
      team: t ? { id: t.id, name: t.name, members: members(t) } : undefined,
      courseware: cw ? toCourseware(cw) : undefined,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      mine: mineEntry(e, me),
      version: e.version,
      reviewStatus: e.reviewStatus ?? 'pending',
      reviewNote: e.reviewNote,
      displaying: e.displaying ?? false,
    }
  }
  const toTeam = (t: DbSpeechTeam, me: DbUser): SpeechTeam => {
    const entry = sp().entries.find((e) => e.teamId === t.id)
    const member = t.memberIds.includes(me.id)
    return {
      id: t.id,
      sessionId: t.sessionId,
      name: t.name,
      leaderId: t.leaderId,
      members: members(t),
      entryId: entry?.id,
      joinCode: !t.assigned && (member || isManage(me)) ? t.joinCode : undefined,
      mine: member,
      version: t.version,
      assigned: t.assigned ?? false,
    }
  }
  const toSession = (s: DbSpeechSession, me?: DbUser): SpeechSession => {
    const list = sp().entries.filter((e) => e.sessionId === s.id && (!me || isManage(me) || mineEntry(e, me)))
    return {
      id: s.id,
      title: s.title,
      date: s.date,
      description: s.description,
      slotMinutes: s.slotMinutes,
      allowTeams: s.allowTeams,
      maxTeamSize: s.maxTeamSize,
      submissionsOpen: s.submissionsOpen,
      status: s.status,
      entryCount: list.length,
      currentEntryId: list.find((e) => e.status === 'speaking')?.id,
      version: s.version,
      createdAt: s.createdAt,
    }
  }
  const toDetail = (s: DbSpeechSession, me: DbUser): SpeechSessionDetail => {
    const entries = sp()
      .entries.filter((e) => e.sessionId === s.id && (isManage(me) || mineEntry(e, me)))
      .sort((a, b) => a.position - b.position)
    const teams = sp().teams.filter((t) => t.sessionId === s.id && (isManage(me) || t.memberIds.includes(me.id)))
    const myTeam = teams.find((t) => t.memberIds.includes(me.id))
    const myEntry = entries.find((e) => mineEntry(e, me))
    return {
      ...toSession(s, me),
      entries: entries.map((e) => toEntry(e, me)),
      teams: teams.map((t) => toTeam(t, me)),
      myEntryId: myEntry?.id,
      myTeamId: myTeam?.id,
    }
  }

  /* ------------------------------ lookups ------------------------------ */
  const findSession = (id: string, me: DbUser, forWrite = false) => {
    const s = sp().sessions.find((x) => x.id === id)
    if (!s || (s.status === 'draft' && !isManage(me) && !forWrite)) throw ApiError.from(404, 'resource.not_found', 'Session not found')
    return s
  }
  const findEntry = (id: string) => {
    const e = sp().entries.find((x) => x.id === id)
    if (!e) throw ApiError.from(404, 'resource.not_found', 'Entry not found')
    return e
  }
  const findTeam = (id: string) => {
    const t = sp().teams.find((x) => x.id === id)
    if (!t) throw ApiError.from(404, 'resource.not_found', 'Team not found')
    return t
  }
  const findCourseware = (id: string) => {
    const c = sp().courseware.find((x) => x.id === id)
    if (!c) throw ApiError.from(404, 'resource.not_found', 'Courseware not found')
    return c
  }
  const teamOf = (sessionId: string, userId: string) => sp().teams.find((t) => t.sessionId === sessionId && t.memberIds.includes(userId))
  const entryOf = (sessionId: string, userId: string) =>
    sp().entries.find((e) => {
      if (e.sessionId !== sessionId) return false
      if (e.ownerId === userId) return true
      const t = e.teamId ? sp().teams.find((x) => x.id === e.teamId) : undefined
      return !!t?.memberIds.includes(userId)
    })
  const isSignUpOpen = (s: DbSpeechSession) => s.status === 'open' && s.submissionsOpen
  const mustBeOpen = (s: DbSpeechSession) => {
    if (!isSignUpOpen(s)) throw ApiError.from(403, 'speech.closed', 'Sign-ups are closed')
  }
  const canEdit = (me: DbUser, e: DbSpeechEntry) => isManage(me) || e.ownerId === me.id
  const canUpload = (me: DbUser, e: DbSpeechEntry) => isManage(me) || mineEntry(e, me)
  const resetReview = (entry: DbSpeechEntry) => {
    delete entry.reviewStatus
    delete entry.reviewNote
    entry.displaying = false
    entry.version += 1
  }
  const resetTeamReview = (team: DbSpeechTeam) => {
    const entry = sp().entries.find((item) => item.teamId === team.id)
    if (!entry) return
    if (entry.status !== 'queued') throw ApiError.from(409, 'resource.conflict', 'Group changes require a queued entry')
    resetReview(entry)
  }
  const editableCourseware = (entry: DbSpeechEntry, me: DbUser) => {
    const session = findSession(entry.sessionId, me)
    if (!canUpload(me, entry)) throw ApiError.from(403, 'permission.denied', 'Not your entry')
    if (!isManage(me)) mustBeOpen(session)
    if (entry.status !== 'queued') throw ApiError.from(403, 'speech.closed', 'Courseware is locked')
  }

  const renumber = (sessionId: string) => {
    sp()
      .entries.filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.position - b.position)
      .forEach((e, i) => (e.position = i + 1))
  }
  const removeCourseware = (entryId: string) => {
    const db = sp()
    for (const c of db.courseware.filter((x) => x.entryId === entryId)) dropFile(c.id)
    db.courseware = db.courseware.filter((c) => c.entryId !== entryId)
  }
  const removeEntry = (e: DbSpeechEntry) => {
    removeCourseware(e.id)
    sp().entries = sp().entries.filter((x) => x.id !== e.id)
    renumber(e.sessionId)
  }
  const topicOf = (body: unknown): string => {
    const topic = String((body as { topic?: unknown } | undefined)?.topic ?? '').trim()
    if (!topic) throw ApiError.from(400, 'validation.failed', 'Validation failed', { topic: ['required'] })
    if (topic.length > 120) throw ApiError.from(400, 'validation.failed', 'Validation failed', { topic: ['too_long'] })
    return topic
  }

  /** Shared by self sign-up and manage on-behalf sign-up. */
  function createEntry(s: DbSpeechSession, owner: DbUser, topic: string, teamId?: string): DbSpeechEntry {
    let team: DbSpeechTeam | undefined
    if (teamId) {
      team = findTeam(teamId)
      if (team.sessionId !== s.id) throw ApiError.from(404, 'resource.not_found', 'Team not found')
      if (team.leaderId !== owner.id) throw ApiError.from(403, 'speech.not_leader', 'Only the team leader can sign the team up')
      if (sp().entries.some((e) => e.teamId === team!.id)) throw ApiError.from(409, 'speech.already_signed_up', 'Already signed up')
    } else {
      if (entryOf(s.id, owner.id)) throw ApiError.from(409, 'speech.already_signed_up', 'Already signed up')
      if (teamOf(s.id, owner.id)) throw ApiError.from(409, 'speech.team_exists', 'Already in a team')
    }
    const position = Math.max(0, ...sp().entries.filter((e) => e.sessionId === s.id).map((e) => e.position)) + 1
    const e: DbSpeechEntry = { id: newId(), sessionId: s.id, position, topic, status: 'queued', ownerId: owner.id, teamId: team?.id, version: 1 }
    sp().entries.push(e)
    return e
  }

  const code = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (;;) {
      const c = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
      if (!sp().teams.some((t) => t.joinCode === c)) return c
    }
  }

  /* ------------------------------ read ------------------------------ */
  route('GET', '/speech/capabilities', (ctx): Capabilities => {
    currentUser(ctx)
    const s = getDb().settings.speech
    return {
      pptConverter: false,
      maxCoursewareMb: s.maxCoursewareMb,
      allowedKinds: ['pptx', 'ppt', 'pdf', 'web'],
      defaults: { slotMinutes: s.defaultSlotMinutes, allowTeams: s.allowTeams, maxTeamSize: s.maxTeamSize },
    }
  })

  const listSessions =
    (includeDraft: boolean): Handler =>
    (ctx) => {
      const me = includeDraft ? need(ctx, 'speech.manage') : currentUser(ctx)
      const st = ctx.query.status
      const list = sp()
        .sessions.filter((s) => includeDraft || s.status !== 'draft')
        .filter((s) => !st || s.status === st)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .map((session) => toSession(session, me))
      return paginate(list, ctx.query)
    }
  route('GET', '/speech/sessions', listSessions(false))
  route('GET', '/admin/speech/sessions', listSessions(true))

  route('GET', '/speech/sessions/:id', (ctx) => {
    const me = currentUser(ctx)
    return toDetail(findSession(ctx.params.id!, me), me)
  })

  /* ------------------------------ sign-up & teams ------------------------------ */
  route('POST', '/speech/sessions/:id/entries', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const s = findSession(ctx.params.id!, me)
    mustBeOpen(s)
    const topic = topicOf(ctx.body)
    const e = createEntry(s, me, topic, (ctx.body as { teamId?: string }).teamId || undefined)
    audit(me, 'speech.entry.create', 'speechEntry', e.id, `Signed up: ${topic}`)
    persist()
    return status(201, toEntry(e, me))
  })

  route('PATCH', '/speech/entries/:id', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const e = findEntry(ctx.params.id!)
    if (!canEdit(me, e)) throw ApiError.from(403, 'permission.denied', 'Not your entry')
    if (!isManage(me)) mustBeOpen(findSession(e.sessionId, me))
    if (e.status !== 'queued') throw ApiError.from(409, 'resource.conflict', 'Entry is locked')
    const b = ctx.body as { topic: string; version: number }
    if (b.version !== e.version) throw ApiError.from(409, 'resource.version_mismatch', 'Entry changed elsewhere')
    const topic = topicOf(b)
    if (e.topic !== topic) resetReview(e)
    e.topic = topic
    audit(me, 'speech.entry.update', 'speechEntry', e.id, `Changed topic: ${e.topic}`)
    persist()
    return toEntry(e, me)
  })

  route('DELETE', '/speech/entries/:id', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const e = findEntry(ctx.params.id!)
    if (!canEdit(me, e)) throw ApiError.from(403, 'permission.denied', 'Not your entry')
    if (!isManage(me)) {
      mustBeOpen(findSession(e.sessionId, me))
      if (e.status !== 'queued') throw ApiError.from(409, 'resource.conflict', 'Entry is locked')
    }
    removeEntry(e)
    audit(me, 'speech.entry.delete', 'speechEntry', e.id, `Cancelled: ${e.topic}`)
    persist()
    return status(204)
  })

  route('POST', '/speech/sessions/:id/teams', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const s = findSession(ctx.params.id!, me)
    mustBeOpen(s)
    if (!s.allowTeams) throw ApiError.from(403, 'speech.teams_disabled', 'Teams are not allowed in this session')
    const name = String((ctx.body as { name?: unknown } | undefined)?.name ?? '').trim()
    if (!name) throw ApiError.from(400, 'validation.failed', 'Validation failed', { name: ['required'] })
    if (entryOf(s.id, me.id)) throw ApiError.from(409, 'speech.already_signed_up', 'Already signed up')
    if (teamOf(s.id, me.id)) throw ApiError.from(409, 'speech.team_exists', 'Already in a team')
    const t: DbSpeechTeam = { id: newId(), sessionId: s.id, name, leaderId: me.id, memberIds: [me.id], joinCode: code(), version: 1 }
    sp().teams.push(t)
    audit(me, 'speech.team.create', 'speechTeam', t.id, `Created team ${name}`)
    persist()
    return status(201, toTeam(t, me))
  })

  route('POST', '/speech/teams/join', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const raw = String((ctx.body as { code?: unknown } | undefined)?.code ?? '')
      .trim()
      .toUpperCase()
    if (!raw) throw ApiError.from(400, 'validation.failed', 'Validation failed', { code: ['required'] })
    const t = sp().teams.find((x) => !x.assigned && x.joinCode.toUpperCase() === raw)
    if (!t) throw ApiError.from(404, 'resource.not_found', 'No team with that code', { code: ['wrong'] })
    const s = findSession(t.sessionId, me)
    mustBeOpen(s)
    if (teamOf(s.id, me.id)?.id === t.id) return toTeam(t, me)
    if (teamOf(s.id, me.id)) throw ApiError.from(409, 'speech.team_exists', 'Already in a team')
    if (entryOf(s.id, me.id)) throw ApiError.from(409, 'speech.already_signed_up', 'Already signed up')
    if (t.memberIds.length >= s.maxTeamSize) throw ApiError.from(409, 'speech.team_full', 'Team is full')
    resetTeamReview(t)
    t.memberIds.push(me.id)
    t.version += 1
    audit(me, 'speech.team.join', 'speechTeam', t.id, `Joined team ${t.name}`)
    persist()
    return toTeam(t, me)
  })

  route('DELETE', '/speech/teams/:id/members/:userId', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const t = findTeam(ctx.params.id!)
    const target = ctx.params.userId!
    if (!t.memberIds.includes(target)) throw ApiError.from(404, 'resource.not_found', 'Not a member')
    const self = target === me.id
    if (!isManage(me)) {
      if (t.assigned) throw ApiError.from(403, 'permission.denied', 'Staff assignment')
      mustBeOpen(findSession(t.sessionId, me))
    }
    if (!self && t.leaderId !== me.id && !isManage(me)) throw ApiError.from(403, 'speech.not_leader', 'Only the leader can remove members')
    if (target === t.leaderId) throw ApiError.from(409, 'resource.conflict', 'The leader cannot leave: disband the team instead')
    resetTeamReview(t)
    t.memberIds = t.memberIds.filter((x) => x !== target)
    t.version += 1
    audit(me, self ? 'speech.team.leave' : 'speech.team.kick', 'speechTeam', t.id, `${self ? 'Left' : 'Removed a member from'} team ${t.name}`)
    persist()
    return status(204)
  })

  route('DELETE', '/speech/teams/:id', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const t = findTeam(ctx.params.id!)
    if (t.leaderId !== me.id && !isManage(me)) throw ApiError.from(403, 'speech.not_leader', 'Only the leader can disband the team')
    if (!isManage(me)) {
      if (t.assigned) throw ApiError.from(403, 'permission.denied', 'Staff assignment')
      mustBeOpen(findSession(t.sessionId, me))
    }
    const entry = sp().entries.find((e) => e.teamId === t.id)
    if (entry && t.assigned) { resetTeamReview(t); delete entry.teamId }
    else if (entry) removeEntry(entry)
    sp().teams = sp().teams.filter((x) => x.id !== t.id)
    audit(me, 'speech.team.disband', 'speechTeam', t.id, `Disbanded team ${t.name}`)
    persist()
    return status(204)
  })

  /* ------------------------------ courseware ------------------------------ */
  route('POST', '/speech/entries/:id/courseware', async (ctx) => {
    const me = need(ctx, 'speech.participate')
    const e = findEntry(ctx.params.id!)
    editableCourseware(e, me)
    const f = ctx.body instanceof FormData ? ctx.body.get('file') : null
    if (!(f instanceof Blob)) throw ApiError.from(400, 'validation.failed', 'file required', { file: ['required'] })
    const name = (f as File).name || 'file'
    const kind = kindFromName(name)
    if (!kind) throw ApiError.from(422, 'courseware.unsupported_type', 'Unsupported courseware type')
    if (f.size > getDb().settings.speech.maxCoursewareMb * 1024 * 1024) throw ApiError.from(413, 'courseware.too_large', 'File too large')

    const bytes = await readBytes(f)
    const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
    if (kind === 'pdf' && !startsWith(0x25, 0x50, 0x44, 0x46)) throw ApiError.from(422, 'courseware.unsupported_type', 'Not a PDF')
    if (kind === 'ppt' && !startsWith(0xd0, 0xcf, 0x11, 0xe0)) throw ApiError.from(422, 'courseware.unsupported_type', 'Not a PowerPoint file')
    if (kind === 'pptx' || kind === 'web') {
      let names: string[]
      try {
        names = zipEntryNames(bytes)
      } catch {
        throw ApiError.from(422, kind === 'web' ? 'courseware.invalid_archive' : 'courseware.unsupported_type', 'Not a valid archive')
      }
      if (kind === 'pptx') {
        if (!names.includes('[Content_Types].xml') || !names.some((n) => n.startsWith('ppt/')))
          throw ApiError.from(422, 'courseware.unsupported_type', 'Not a pptx file')
      } else {
        if (names.length > 2000 || names.some((n) => n.startsWith('/') || n.split('/').includes('..')))
          throw ApiError.from(422, 'courseware.invalid_archive', 'Unsafe archive')
        if (!findWebIndex(names)) throw ApiError.from(422, 'courseware.invalid_archive', 'index.html is missing')
      }
    }

    removeCourseware(e.id)
    const c: DbCourseware = {
      id: newId(),
      entryId: e.id,
      kind,
      originalName: name,
      size: f.size,
      conversion: 'none',
      uploadedAt: new Date().toISOString(),
      uploaderId: me.id,
    }
    sp().courseware.push(c)
    resetReview(e)
    putFile(c.id, f instanceof File ? f : new File([f], name))
    audit(me, 'courseware.upload', 'courseware', c.id, `Uploaded ${name}`)
    persist()
    return status(201, toCourseware(c))
  })

  const privateCourseware = (ctx: Ctx) => {
    const me = currentUser(ctx)
    const file = findCourseware(ctx.params.id!)
    const entry = findEntry(file.entryId)
    findSession(entry.sessionId, me)
    if (!isManage(me) && !mineEntry(entry, me)) throw ApiError.from(404, 'resource.not_found', 'Courseware not found')
    return file
  }
  route('GET', '/speech/courseware/:id', (ctx) => toCourseware(privateCourseware(ctx)))

  const fileOrGone = (c: DbCourseware) => {
    const f = getFile(c.id)
    if (!f) throw ApiError.from(404, 'courseware.file_missing', 'The file is not kept in this demo any more')
    return f
  }

  route('GET', '/speech/courseware/:id/download', (ctx) => {
    need(ctx, 'speech.manage')
    return fileOrGone(privateCourseware(ctx))
  })
  route('GET', '/speech/courseware/:id/preview', (ctx) => {
    const file = privateCourseware(ctx)
    if (file.kind === 'ppt') throw ApiError.from(404, 'resource.not_found', 'Preview unavailable')
    const data = fileOrGone(file)
    return file.kind === 'pdf' ? new Blob([data], { type: 'application/pdf' }) : data
  })

  route('DELETE', '/speech/courseware/:id', (ctx) => {
    const me = need(ctx, 'speech.participate')
    const c = findCourseware(ctx.params.id!)
    const entry = findEntry(c.entryId)
    editableCourseware(entry, me)
    resetReview(entry)
    dropFile(c.id)
    sp().courseware = sp().courseware.filter((x) => x.id !== c.id)
    audit(me, 'courseware.delete', 'courseware', c.id, `Deleted ${c.originalName}`)
    persist()
    return status(204)
  })

  /* ------------------------------ admin ------------------------------ */
  const sessionFields = (b: Record<string, unknown>) => {
    const errors: Record<string, string[]> = {}
    const title = String(b.title ?? '').trim()
    const date = String(b.date ?? '').trim()
    if (!title) errors.title = ['required']
    if (!DATE_RE.test(date)) errors.date = [date ? 'invalid' : 'required']
    const defaults = getDb().settings.speech
    const slotMinutes = b.slotMinutes === undefined ? defaults.defaultSlotMinutes : Number(b.slotMinutes)
    const maxTeamSize = b.maxTeamSize === undefined ? defaults.maxTeamSize : Number(b.maxTeamSize)
    if (!(slotMinutes >= 1 && slotMinutes <= 60)) errors.slotMinutes = ['out_of_range']
    if (!(maxTeamSize >= 2 && maxTeamSize <= 20)) errors.maxTeamSize = ['out_of_range']
    if (Object.keys(errors).length) throw ApiError.from(400, 'validation.failed', 'Validation failed', errors)
    return {
      title,
      date,
      description: String(b.description ?? '').trim(),
      slotMinutes,
      maxTeamSize,
      allowTeams: b.allowTeams === undefined ? defaults.allowTeams : Boolean(b.allowTeams),
    }
  }

  route('POST', '/admin/speech/sessions', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const f = sessionFields((ctx.body ?? {}) as Record<string, unknown>)
    const s: DbSpeechSession = { id: newId(), ...f, submissionsOpen: true, status: 'draft', version: 1, createdAt: new Date().toISOString() }
    sp().sessions.push(s)
    audit(me, 'speech.session.create', 'speechSession', s.id, `Created session ${s.title}`)
    persist()
    return status(201, toSession(s))
  })

  route('PUT', '/admin/speech/sessions/:id', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const s = findSession(ctx.params.id!, me)
    const b = (ctx.body ?? {}) as Record<string, unknown>
    if (b.version !== s.version) throw ApiError.from(409, 'resource.version_mismatch', 'Session changed elsewhere')
    Object.assign(s, sessionFields(b))
    if (b.submissionsOpen !== undefined) s.submissionsOpen = Boolean(b.submissionsOpen)
    s.version += 1
    audit(me, 'speech.session.update', 'speechSession', s.id, `Updated session ${s.title}`)
    persist()
    return toSession(s)
  })

  route('DELETE', '/admin/speech/sessions/:id', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const s = findSession(ctx.params.id!, me)
    for (const e of sp().entries.filter((x) => x.sessionId === s.id)) removeCourseware(e.id)
    sp().entries = sp().entries.filter((e) => e.sessionId !== s.id)
    sp().teams = sp().teams.filter((t) => t.sessionId !== s.id)
    sp().sessions = sp().sessions.filter((x) => x.id !== s.id)
    audit(me, 'speech.session.delete', 'speechSession', s.id, `Deleted session ${s.title}`)
    persist()
    return status(204)
  })

  route('POST', '/admin/speech/sessions/:id/status', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const s = findSession(ctx.params.id!, me)
    const to = (ctx.body as { status?: SpeechSessionStatus } | undefined)?.status
    if (!to || !(to in TRANSITIONS)) throw ApiError.from(400, 'validation.failed', 'Validation failed', { status: ['required'] })
    if (!TRANSITIONS[s.status].includes(to)) throw ApiError.from(409, 'resource.conflict', `Cannot go from ${s.status} to ${to}`)
    if (to === 'closed' || to === 'open') {
      const active = sp().entries.find((e) => e.sessionId === s.id && e.status === 'speaking')
      if (active) { active.status = 'done'; active.displaying = false; active.version += 1 }
    }
    s.status = to
    s.version += 1
    audit(me, 'speech.session.status', 'speechSession', s.id, `Session ${s.title} is now ${to}`)
    persist()
    return toSession(s)
  })

  route('PUT', '/admin/speech/sessions/:id/order', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const s = findSession(ctx.params.id!, me)
    const ids = ((ctx.body as { entryIds?: string[] } | undefined)?.entryIds ?? []) as string[]
    const queued = sp().entries.filter((e) => e.sessionId === s.id && e.status === 'queued')
    const same = ids.length === queued.length && new Set(ids).size === ids.length && queued.every((e) => ids.includes(e.id))
    if (!same) throw ApiError.from(400, 'validation.failed', 'entryIds must be exactly the queued entries', { entryIds: ['invalid'] })
    // queued entries take the queued slots in the new order; done / speaking ones keep their place
    const slots = queued.map((e) => e.position).sort((a, b) => a - b)
    ids.forEach((id, i) => (sp().entries.find((e) => e.id === id)!.position = slots[i]!))
    audit(me, 'speech.session.order', 'speechSession', s.id, `Reordered the queue of ${s.title}`)
    persist()
    return toDetail(s, me)
  })

  const entryAction =
    (action: 'start' | 'finish' | 'skip'): Handler =>
    (ctx) => {
      const me = need(ctx, 'speech.manage')
      const e = findEntry(ctx.params.id!)
      const session = findSession(e.sessionId, me)
      const now = new Date().toISOString()
      if (action === 'start') {
        if (session.status === 'draft' || session.status === 'closed') throw ApiError.from(403, 'speech.closed', 'Meeting is closed')
        if (e.status !== 'queued' && e.status !== 'skipped') throw ApiError.from(409, 'resource.conflict', 'Only queued or skipped entries can start')
        if (e.reviewStatus !== 'approved') throw ApiError.from(409, 'speech.review_required', 'Approve the entry first')
        if (sp().entries.some((x) => x.sessionId === e.sessionId && x.status === 'speaking'))
          throw ApiError.from(409, 'speech.speaking_exists', 'Someone is already speaking')
        e.status = 'speaking'
        e.startedAt = now
        session.status = 'running'
      } else if (action === 'finish') {
        if (e.status !== 'speaking') throw ApiError.from(409, 'resource.conflict', 'Only the current speaker can finish')
        e.status = 'done'
        e.finishedAt = now
      } else {
        if (e.status !== 'queued' && e.status !== 'speaking') throw ApiError.from(409, 'resource.conflict', 'Entry is already finished')
        e.status = 'skipped'
        e.finishedAt = now
      }
      if (action !== 'start') e.displaying = false
      e.version += 1
      audit(me, `speech.entry.${action}`, 'speechEntry', e.id, `${action}: ${e.topic}`)
      persist()
      return toEntry(e, me)
    }
  route('POST', '/admin/speech/entries/:id/start', entryAction('start'))
  route('POST', '/admin/speech/entries/:id/finish', entryAction('finish'))
  route('POST', '/admin/speech/entries/:id/skip', entryAction('skip'))
  route('PUT', '/admin/speech/entries/:id/review', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const entry = findEntry(ctx.params.id!)
    if (entry.status !== 'queued' && entry.status !== 'skipped') throw ApiError.from(409, 'resource.conflict', 'Entry is locked')
    const body = ctx.body as { status: 'approved' | 'returned'; note?: string; version: number }
    if (body.version !== entry.version) throw ApiError.from(409, 'resource.version_mismatch', 'Entry changed elsewhere')
    const note = body.note?.trim()
    if (!['approved', 'returned'].includes(body.status) || (body.status === 'returned' && (!note || note.length > 500)))
      throw ApiError.from(400, 'validation.failed', 'Choose a valid review outcome')
    entry.reviewStatus = body.status
    entry.reviewNote = body.status === 'returned' ? note : undefined
    entry.version += 1
    audit(me, 'speech.entry.reviewed', 'speechEntry', entry.id, body.status)
    persist()
    return toEntry(entry, me)
  })
  route('POST', '/admin/speech/courseware/:id/display', (ctx) => {
    need(ctx, 'speech.manage')
    throw ApiError.from(409, 'speech.display_requires_backend', 'Public display requires the server')
  })
  route('GET', '/admin/speech/sessions/:id/group-candidates', (ctx) => {
    const me = need(ctx, 'speech.manage')
    findSession(ctx.params.id!, me)
    const search = String(ctx.query.q ?? '').trim().toLowerCase()
    const candidates = getDb().users.filter((user) => user.status === 'active' && [user.displayName, user.username].some((value) => value.toLowerCase().includes(search)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    return paginate(candidates.map((user) => person(user.id)), ctx.query)
  })
  const assignTeam: Handler = (ctx) => {
    const me = need(ctx, 'speech.manage')
    const session = findSession(ctx.params.id!, me)
    if (!session.allowTeams) throw ApiError.from(403, 'speech.teams_disabled', 'Teams are disabled')
    if (session.status === 'closed') throw ApiError.from(403, 'speech.closed', 'Meeting is closed')
    const { name, leaderId, memberIds, version } = ctx.body as AssignedTeamInput
    if (!name?.trim() || name.trim().length > 100 || !Array.isArray(memberIds) || memberIds.length < 2 || memberIds.length > session.maxTeamSize ||
      new Set(memberIds).size !== memberIds.length || !memberIds.includes(leaderId) ||
      !memberIds.every((id) => getDb().users.some((user) => user.id === id && user.status === 'active')))
      throw ApiError.from(400, 'validation.failed', 'Choose a valid name, members and leader')
    const teamId = ctx.params.teamId
    const team = teamId ? findTeam(teamId) : { id: newId(), sessionId: session.id, name: '', leaderId, memberIds: [], joinCode: '', version: 0 }
    if (team.sessionId !== session.id) throw ApiError.from(404, 'resource.not_found', 'Group not found')
    if (teamId && version !== team.version) throw ApiError.from(409, 'resource.version_mismatch', 'Group changed elsewhere')
    if (sp().teams.some((item) => item.sessionId === session.id && item.id !== team.id && item.memberIds.some((id) => memberIds.includes(id))))
      throw ApiError.from(409, 'speech.team_exists', 'A selected member is already grouped')
    const attached = sp().entries.find((e) => e.teamId === team.id)
    const solo = sp().entries.filter((e) => e.sessionId === session.id && !e.teamId && memberIds.includes(e.ownerId))
    if (solo.some((e) => attached || e.ownerId !== leaderId)) throw ApiError.from(409, 'speech.already_signed_up', 'Resolve independent submissions first')
    const entry = attached ?? solo[0]
    if (entry) {
      if (entry.status !== 'queued') throw ApiError.from(409, 'resource.conflict', 'Entry is locked')
      entry.ownerId = leaderId
      entry.teamId = team.id
      resetReview(entry)
    }
    Object.assign(team, { name: name.trim(), leaderId, memberIds, assigned: true, joinCode: '', version: team.version + 1 })
    if (!teamId) sp().teams.push(team)
    audit(me, 'speech.team.assigned', 'speechTeam', team.id, team.name)
    persist()
    return toTeam(team, me)
  }
  route('POST', '/admin/speech/sessions/:id/teams', assignTeam)
  route('PUT', '/admin/speech/sessions/:id/teams/:teamId', assignTeam)

  route('POST', '/admin/speech/sessions/:id/entries', (ctx) => {
    const me = need(ctx, 'speech.manage')
    const s = findSession(ctx.params.id!, me)
    if (s.status === 'closed') throw ApiError.from(403, 'speech.closed', 'Session is closed')
    const b = (ctx.body ?? {}) as { ownerId?: string; teamId?: string }
    if (!b.ownerId) throw ApiError.from(400, 'validation.failed', 'Validation failed', { ownerId: ['required'] })
    const owner = getDb().users.find((u) => u.id === b.ownerId)
    if (!owner) throw ApiError.from(404, 'resource.not_found', 'User not found')
    const e = createEntry(s, owner, topicOf(ctx.body), b.teamId || undefined)
    audit(me, 'speech.entry.create', 'speechEntry', e.id, `Signed ${owner.username} up: ${e.topic}`)
    persist()
    return status(201, toEntry(e, me))
  })
}
