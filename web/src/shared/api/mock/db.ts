/**
 * In-memory + localStorage backed fake of the Classight backend.
 * All content is SYNTHETIC demonstration data; replace via the admin back office
 * (or the real backend) once real class content exists.
 */
import type {
  AdminUser,
  AppearanceSettings,
  AuditLog,
  Invite,
  Permission,
  Role,
  SecuritySettings,
  SiteSettings,
  SpeechSettings,
  SpeechEntryStatus,
  SpeechSessionStatus,
  CoursewareKind,
  ConversionState,
  SetupState,
  StorageSettings,
  TimelineEvent,
} from '../types'

import { clearFiles } from './files'

export type L = { zh: string; en: string }

export interface DbUser extends AdminUser {
  password: string
  bio: L
}
export interface DbSession {
  id: string
  userId: string
  device: string
  ip: string
  createdAt: string
  lastSeenAt: string
  refreshToken: string
}
export interface DbTimeline extends Omit<TimelineEvent, 'title' | 'summary' | 'body' | 'tags'> {
  title: L
  summary: L
  body: L
  tags: string[]
}
export interface DbMember {
  id: string
  name: L
  avatarUrl?: string
  title?: L
  joinedOn?: string
  intro?: L
  linkedUserId?: string
  version: number
}
export interface DbSettings {
  site: SiteSettings
  appearance: AppearanceSettings
  security: SecuritySettings
  storage: StorageSettings
  speech: SpeechSettings
  versions: Record<'site' | 'appearance' | 'security' | 'storage' | 'speech', number>
}

/* ---- class meeting queue: ids reference users, never embed them ---- */
export interface DbSpeechSession {
  id: string
  title: string
  date: string
  description: string
  slotMinutes: number
  allowTeams: boolean
  maxTeamSize: number
  submissionsOpen: boolean
  status: SpeechSessionStatus
  version: number
  createdAt: string
}
export interface DbSpeechEntry {
  id: string
  sessionId: string
  position: number
  topic: string
  status: SpeechEntryStatus
  ownerId: string
  teamId?: string
  startedAt?: string
  finishedAt?: string
  version: number
}
export interface DbSpeechTeam {
  id: string
  sessionId: string
  name: string
  leaderId: string
  memberIds: string[]
  joinCode: string
  version: number
}
/** Metadata only. The file bytes live in an in-memory Map (mock/files.ts) and vanish on reload. */
export interface DbCourseware {
  id: string
  entryId: string
  kind: CoursewareKind
  originalName: string
  size: number
  conversion: ConversionState
  uploadedAt: string
  uploaderId: string
}
export interface DbSetup {
  state: SetupState
  completed: boolean
  /** The wizard demo asks for this token (mock only). */
  token: string
}
export interface Db {
  profile: { id: string; motto: L; intro: L; foundedOn: string; version: number }
  members: DbMember[]
  timeline: DbTimeline[]
  users: DbUser[]
  roles: Role[]
  invites: Invite[]
  sessions: DbSession[]
  audit: AuditLog[]
  settings: DbSettings
  speech: {
    sessions: DbSpeechSession[]
    entries: DbSpeechEntry[]
    teams: DbSpeechTeam[]
    courseware: DbCourseware[]
  }
  setup: DbSetup
}

const KEY = 'classight.mock.db.v3'
export const REFRESH_KEY = 'classight.mock.rt'

export const ALL_PERMISSIONS: Permission[] = [
  'site.settings.read',
  'site.settings.write',
  'class.profile.write',
  'class.members.manage',
  'class.timeline.manage',
  'content.manage',
  'media.upload',
  'users.read',
  'users.manage',
  'roles.manage',
  'invites.manage',
  'audit.read',
  'system.read',
  'system.manage',
  'speech.participate',
  'speech.manage',
  'timetable.manage',
]

const ADMIN_PERMS: Permission[] = [
  'media.upload',
  'class.profile.write',
  'class.members.manage',
  'class.timeline.manage',
  'content.manage',
  'users.read',
  'users.manage',
  'invites.manage',
  'site.settings.read',
  'audit.read',
  'speech.participate',
  'speech.manage',
  'timetable.manage',
]

const id = () => crypto.randomUUID()
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

const MEMBER_NAMES: { zh: string; en: string; title?: L }[] = [
  { zh: '林一舟', en: 'Yizhou Lin', title: { zh: '班长', en: 'Class monitor' } },
  { zh: '苏念', en: 'Nian Su', title: { zh: '学习委员', en: 'Study lead' } },
  { zh: '陈知远', en: 'Zhiyuan Chen', title: { zh: '体育委员', en: 'Sports lead' } },
  { zh: '周可昕', en: 'Kexin Zhou', title: { zh: '文艺委员', en: 'Arts lead' } },
  { zh: '许明川', en: 'Mingchuan Xu' },
  { zh: '何芷若', en: 'Zhiruo He' },
  { zh: '江北辰', en: 'Beichen Jiang' },
  { zh: '顾清禾', en: 'Qinghe Gu' },
  { zh: '程予安', en: 'Yuan Cheng' },
  { zh: '乔星野', en: 'Xingye Qiao' },
  { zh: '宋雨桐', en: 'Yutong Song' },
  { zh: '魏子墨', en: 'Zimo Wei' },
  { zh: '唐朝', en: 'Chao Tang' },
  { zh: '沈未央', en: 'Weiyang Shen' },
  { zh: '傅西洲', en: 'Xizhou Fu' },
  { zh: '简柚', en: 'You Jian' },
  { zh: '孟晚舟', en: 'Wanzhou Meng' },
  { zh: '叶临', en: 'Lin Ye' },
  { zh: '温书意', en: 'Shuyi Wen' },
  { zh: '白昼', en: 'Zhou Bai' },
  { zh: '薛岚', en: 'Lan Xue' },
  { zh: '罗栖', en: 'Qi Luo' },
  { zh: '蒋云深', en: 'Yunshen Jiang' },
  { zh: '钟灵', en: 'Ling Zhong' },
]

function seed(): Db {
  const roles: Role[] = [
    { id: id(), name: 'Member', description: 'Class member', permissions: ['media.upload', 'speech.participate'], builtIn: true },
    { id: id(), name: 'Admin', description: 'Class administrator', permissions: ADMIN_PERMS, builtIn: true },
    { id: id(), name: 'SuperAdmin', description: 'Full access', permissions: ALL_PERMISSIONS, builtIn: true },
  ]

  const users: DbUser[] = [
    {
      id: id(),
      username: 'admin',
      password: 'Admin123!',
      displayName: '管理员',
      email: 'admin@classight.local',
      roles: ['SuperAdmin'],
      status: 'active',
      createdAt: daysAgo(400),
      lastLoginAt: daysAgo(1),
      version: 1,
      bio: { zh: '站点管理员。', en: 'Site administrator.' },
    },
    {
      id: id(),
      username: 'student',
      password: 'Student123!',
      displayName: '林一舟',
      email: 'yizhou@classight.local',
      roles: ['Member'],
      status: 'active',
      createdAt: daysAgo(200),
      lastLoginAt: daysAgo(3),
      version: 1,
      bio: { zh: '喜欢在晚自习后绕操场走一圈。', en: 'Walks a lap of the field after evening study.' },
    },
    {
      id: id(),
      username: 'teacher',
      password: 'Teacher123!',
      displayName: '周老师',
      email: 'teacher@classight.local',
      roles: ['Admin'],
      status: 'active',
      createdAt: daysAgo(300),
      lastLoginAt: daysAgo(2),
      version: 1,
      bio: { zh: '班主任。', en: 'Homeroom teacher.' },
    },
  ]

  // demo classmates for the speech queue (Member role, password Student123!)
  const PEERS: [string, string, string][] = [
    ['sunian', '苏念', 'sunian@classight.local'],
    ['chenzhiyuan', '陈知远', 'zhiyuan@classight.local'],
    ['zhoukexin', '周可昕', 'kexin@classight.local'],
    ['xumingchuan', '许明川', 'mingchuan@classight.local'],
    ['hezhiruo', '何芷若', 'zhiruo@classight.local'],
    ['jiangbeichen', '江北辰', 'beichen@classight.local'],
  ]
  for (const [username, displayName, email] of PEERS)
    users.push({
      id: id(),
      username,
      password: 'Student123!',
      displayName,
      email,
      roles: ['Member'],
      status: 'active',
      createdAt: daysAgo(150),
      lastLoginAt: daysAgo(5),
      version: 1,
      bio: { zh: '', en: '' },
    })

  const members: DbMember[] = MEMBER_NAMES.map((m, i) => ({
    id: id(),
    name: { zh: m.zh, en: m.en },
    title: m.title,
    joinedOn: '2024-09-01',
    linkedUserId: i === 0 ? users[1]!.id : undefined,
    version: 1,
  }))

  const tl = (daysBack: number, title: L, summary: L, tags: string[]): DbTimeline => ({
    id: id(),
    title,
    summary,
    body: { zh: '示例内容：这里将展示该事件的完整记录。', en: 'Sample content: the full record of this event lives here.' },
    occurredOn: daysAgo(daysBack).slice(0, 10),
    tags,
  })
  const timeline: DbTimeline[] = [
    tl(
      800,
      { zh: '开学第一天', en: 'First day of school' },
      { zh: '四十个人，一间教室，座位表抽签决定。', en: 'Forty people, one classroom, seats drawn by lot.' },
      ['start'],
    ),
    tl(
      640,
      { zh: '第一次班会', en: 'The first class meeting' },
      { zh: '我们决定了班名、班规，以及谁来擦黑板。', en: 'We settled the class name, the rules, and who wipes the board.' },
      ['meeting'],
    ),
    tl(
      520,
      { zh: '秋季运动会', en: 'Autumn sports day' },
      { zh: '接力赛最后一棒掉了棒，但全班都在喊。', en: 'The relay baton dropped on the last leg; the whole class kept shouting.' },
      ['sports'],
    ),
    tl(
      390,
      { zh: '跨年晚会', en: 'New Year show' },
      { zh: '在教室里布置灯串，十二点准时倒数。', en: 'String lights in the classroom, countdown at midnight.' },
      ['event'],
    ),
    tl(
      260,
      { zh: '春游', en: 'Spring outing' },
      { zh: '山路比想象中长，野餐比想象中好吃。', en: 'The trail was longer than expected, the picnic better.' },
      ['outing'],
    ),
    tl(
      120,
      { zh: '期中之后', en: 'After midterms' },
      { zh: '一起复盘，也一起吃了顿火锅。', en: 'We reviewed together, and then ate hotpot together.' },
      ['daily'],
    ),
    tl(
      45,
      { zh: '班级网站上线', en: 'Class website goes live' },
      { zh: '名字变成了会动的粒子。', en: 'The name became particles that move.' },
      ['site'],
    ),
  ]

  return {
    profile: {
      id: id(),
      motto: { zh: '一间教室，很多个明天。', en: 'One classroom, many tomorrows.' },
      intro: {
        zh: '这是示例简介：我们是一个普通又不普通的班级。这里记录我们一起走过的日子，也留给之后的每一个人。',
        en: 'Sample intro: we are an ordinary and not-so-ordinary class. This place keeps the days we walked together, for everyone who comes after.',
      },
      foundedOn: '2024-09-01',
      version: 1,
    },
    members,
    timeline,
    users,
    roles,
    invites: [
      { id: id(), code: 'CLASS2026', role: 'Member', maxUses: 50, usedCount: 3, expiresAt: daysAgo(-60), createdAt: daysAgo(30) },
    ],
    sessions: [],
    audit: [
      {
        id: id(),
        at: daysAgo(2),
        actor: 'admin',
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: 'site',
        summary: 'Updated site settings',
        changes: [{ field: 'slogan', before: '', after: '一间教室，很多个明天。' }],
      },
    ],
    settings: {
      site: { className: 'Classight', classNameEn: 'Classight', slogan: '一间教室，很多个明天。' },
      appearance: { particleQualityDefault: 'high', particleColor: '#0b1220', accentColor: '#ff6a3d' },
      security: { registrationMode: 'invite', minPasswordLength: 8, sessionHours: 24, classInfoPublic: true },
      storage: { provider: 'local', maxUploadMb: 10 },
      speech: { defaultSlotMinutes: 5, allowTeams: true, maxTeamSize: 4, maxCoursewareMb: 50 },
      versions: { site: 1, appearance: 1, security: 1, storage: 1, speech: 1 },
    },
    speech: seedSpeech(users),
    setup: { state: 'ready', completed: true, token: 'demo-setup' },
  }
}

/**
 * Synthetic demo queue: one running session (someone is speaking), one open for sign-up with an
 * invitable team, one finished, one draft. Dates are relative to today so the demo never goes stale.
 */
function seedSpeech(users: DbUser[]): Db['speech'] {
  const u = (name: string) => users.find((x) => x.username === name)!.id
  const dayStr = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)
  const mk = (title: string, date: string, status: DbSpeechSession['status'], description: string, submissionsOpen: boolean): DbSpeechSession => ({
    id: id(),
    title,
    date,
    description,
    slotMinutes: 5,
    allowTeams: true,
    maxTeamSize: 4,
    submissionsOpen,
    status,
    version: 1,
    createdAt: daysAgo(20),
  })
  const running = mk('主题班会：我眼中的下一个学期（演示数据）', dayStr(0), 'running', '每人五分钟，可以单人也可以组队。演示数据，请在后台替换。', false)
  const open = mk('主题班会：一本书，一段路（演示数据）', dayStr(7), 'open', '分享一本影响了你的书或一段难忘的旅程。演示数据，请在后台替换。', true)
  const closed = mk('主题班会：新学期自我介绍（演示数据）', dayStr(-30), 'closed', '已结束的场次，仅作演示。', false)
  const draft = mk('主题班会：毕业季（演示数据）', dayStr(21), 'draft', '尚未公开的草稿场次。', true)
  const sessions = [running, open, closed, draft]

  const entries: DbSpeechEntry[] = []
  const teams: DbSpeechTeam[] = []
  const courseware: DbCourseware[] = []
  const entry = (s: DbSpeechSession, position: number, topic: string, status: DbSpeechEntry['status'], ownerId: string, teamId?: string): DbSpeechEntry => {
    const e: DbSpeechEntry = {
      id: id(),
      sessionId: s.id,
      position,
      topic,
      status,
      ownerId,
      teamId,
      startedAt: status === 'speaking' || status === 'done' ? daysAgo(0) : undefined,
      finishedAt: status === 'done' ? daysAgo(0) : undefined,
      version: 1,
    }
    entries.push(e)
    return e
  }
  const team = (s: DbSpeechSession, name: string, leader: string, others: string[], code: string): DbSpeechTeam => {
    const t: DbSpeechTeam = { id: id(), sessionId: s.id, name, leaderId: leader, memberIds: [leader, ...others], joinCode: code, version: 1 }
    teams.push(t)
    return t
  }

  // running: 1 done, 1 speaking, 3 queued (one is a team)
  const e1 = entry(running, 1, '从一次迟到说起：时间管理小实验', 'done', u('xumingchuan'))
  entry(running, 2, '操场边的十分钟：我的晚自习后散步', 'speaking', u('sunian'))
  const tRun = team(running, '晨读小队', u('zhoukexin'), [u('hezhiruo')], 'DEMO-RUN1')
  const e3 = entry(running, 3, '把课本读成故事：晨读改造计划', 'queued', u('zhoukexin'), tRun.id)
  entry(running, 4, '一个数学错题本的自我修养', 'queued', u('jiangbeichen'))
  entry(running, 5, '为什么我们的黑板报总是最后完成', 'queued', u('chenzhiyuan'))
  // a past slide deck whose file is not kept in this demo
  courseware.push({
    id: id(),
    entryId: e1.id,
    kind: 'pdf',
    originalName: '时间管理小实验.pdf',
    size: 2_411_520,
    conversion: 'none',
    uploadedAt: daysAgo(1),
    uploaderId: u('xumingchuan'),
  })
  courseware.push({
    id: id(),
    entryId: e3.id,
    kind: 'pptx',
    originalName: '晨读改造计划.pptx',
    size: 6_820_352,
    conversion: 'none',
    uploadedAt: daysAgo(0),
    uploaderId: u('zhoukexin'),
  })

  // open: sign-ups welcome; a team with a join code anyone can use
  const tOpen = team(open, '读书会', u('chenzhiyuan'), [u('sunian')], 'DEMO-BOOK')
  entry(open, 1, '《额尔古纳河右岸》读后感', 'queued', u('chenzhiyuan'), tOpen.id)
  entry(open, 2, '骑行川藏线的七个夜晚', 'queued', u('xumingchuan'))

  // closed: history
  entry(closed, 1, '我的暑假：二十天的志愿者日记', 'done', u('hezhiruo'))
  entry(closed, 2, '三分钟学会魔方', 'done', u('jiangbeichen'))
  entry(closed, 3, '关于换座位的一份提案', 'skipped', u('sunian'))

  return { sessions, entries, teams, courseware }
}

let db: Db | null = null

export function getDb(): Db {
  if (db) return db
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (raw) {
      db = JSON.parse(raw) as Db
      if (!localStorage.getItem('classight.mock.timetable.permission.v1')) {
        for (const role of db.roles) if (role.builtIn && (role.name === 'Admin' || role.name === 'SuperAdmin') && !role.permissions.includes('timetable.manage')) role.permissions.push('timetable.manage')
        localStorage.setItem('classight.mock.timetable.permission.v1', '1')
        persist()
      }
      return db
    }
  } catch {
    /* fall through to seed */
  }
  db = seed()
  persist()
  return db
}

export function persist() {
  try {
    if (db && typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage full / unavailable: mock keeps working in memory */
  }
}

export function resetDb() {
  clearFiles()
  db = seed()
  persist()
  try {
    localStorage.removeItem(REFRESH_KEY)
  } catch {
    /* noop */
  }
}

export const newId = id
