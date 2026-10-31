/**
 * Wire types. Mirrors docs/api-contract.md. Once the backend publishes OpenAPI
 * these are replaced by generated types (openapi-typescript); keep names stable.
 */

export type Uuid = string
export type IsoDate = string

export type Permission =
  | 'site.settings.read'
  | 'site.settings.write'
  | 'class.profile.write'
  | 'class.members.manage'
  | 'class.timeline.manage'
  | 'content.manage'
  | 'media.upload'
  | 'users.read'
  | 'users.manage'
  | 'roles.manage'
  | 'invites.manage'
  | 'audit.read'
  | 'system.read'
  | 'system.manage'
  | 'speech.participate'
  | 'speech.manage'
  | 'timetable.manage'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface PageQuery {
  page?: number
  pageSize?: number
  sort?: string
  q?: string
}

/* ---------- site ---------- */
export type QualityTier = 'high' | 'medium' | 'low' | 'static'

export interface SitePublic {
  className: string
  classNameEn?: string
  slogan: string
  appearance: {
    particleQualityDefault: QualityTier
    palette: { particle: string; accent: string }
    fontSubsetUrl?: string
  }
  registrationMode: 'invite' | 'closed'
  apiVersion: string
  features: { mongo: boolean; redis: boolean }
}

/* ---------- auth / me ---------- */
export interface UserSelf {
  id: Uuid
  username: string
  displayName: string
  avatarUrl?: string
  email?: string
  bio: string
  roles: string[]
  permissions: Permission[]
  createdAt: IsoDate
  version: number
}

export interface AuthResult {
  accessToken: string
  expiresIn: number
  user: UserSelf
}

export interface RefreshResult {
  accessToken: string
  expiresIn: number
}

export interface LoginRequest {
  account: string
  password: string
  captcha?: { token: string; randstr?: string }
}

export interface RegisterRequest {
  inviteCode: string
  username: string
  displayName: string
  password: string
  email?: string
  captcha?: { token: string; randstr?: string }
}

export interface SessionInfo {
  id: Uuid
  device: string
  ip: string
  createdAt: IsoDate
  lastSeenAt: IsoDate
  current: boolean
}

export interface ConsoleShortcut {
  key: string
  label: string
  route: string
  permission?: Permission
}

export interface ConsoleOverview {
  user: UserSelf
  linkedMember?: MemberPublic
  shortcuts: ConsoleShortcut[]
  unreadNotifications: number
}

/* ---------- class ---------- */
export interface ClassProfile {
  id: Uuid
  name: string
  nameEn?: string
  motto: string
  intro: string
  foundedOn: IsoDate
  coverUrl?: string
  version: number
}

export interface MemberPublic {
  id: Uuid
  displayName: string
  avatarUrl?: string
  title?: string
  joinedOn?: IsoDate
  intro?: string
}

export interface TimelineEvent {
  id: Uuid
  title: string
  summary: string
  occurredOn: IsoDate
  coverUrl?: string
  tags: string[]
  body?: string
}

export interface ClassOverview {
  profile: ClassProfile
  stats: { memberCount: number; timelineCount: number; foundedYears: number }
  membersPreview: MemberPublic[]
  latestTimeline: TimelineEvent[]
}

/* ---------- admin ---------- */
export type UserStatus = 'active' | 'disabled'

export interface AdminUser {
  id: Uuid
  username: string
  displayName: string
  email?: string
  avatarUrl?: string
  roles: string[]
  status: UserStatus
  createdAt: IsoDate
  lastLoginAt?: IsoDate
  version: number
}

export interface Role {
  id: Uuid
  name: string
  description: string
  permissions: Permission[]
  builtIn: boolean
}

export interface PermissionGroup {
  module: string
  permissions: { code: Permission; description: string }[]
}

export interface Invite {
  id: Uuid
  code: string
  role: string
  maxUses: number
  usedCount: number
  expiresAt?: IsoDate
  createdAt: IsoDate
}

export interface AdminMember extends MemberPublic {
  linkedUserId?: Uuid
  version: number
}

export type SettingsGroupKey = 'site' | 'appearance' | 'security' | 'storage' | 'speech'

export interface SiteSettings {
  className: string
  classNameEn: string
  slogan: string
}
export interface AppearanceSettings {
  particleQualityDefault: QualityTier
  particleColor: string
  accentColor: string
}
export interface SecuritySettings {
  registrationMode: 'invite' | 'closed'
  minPasswordLength: number
  sessionHours: number
  classInfoPublic: boolean
}
export interface StorageSettings {
  provider: 'local' | 's3'
  maxUploadMb: number
}

export interface SpeechSettings {
  defaultSlotMinutes: number
  allowTeams: boolean
  maxTeamSize: number
  maxCoursewareMb: number
}

export interface SettingsGroupMap {
  site: SiteSettings
  appearance: AppearanceSettings
  security: SecuritySettings
  storage: StorageSettings
  speech: SpeechSettings
}

export interface SettingsEnvelope<K extends SettingsGroupKey = SettingsGroupKey> {
  group: K
  values: SettingsGroupMap[K]
  version: number
}

export interface AuditLog {
  id: Uuid
  at: IsoDate
  actor: string
  action: string
  resourceType: string
  resourceId?: string
  summary: string
  changes?: { field: string; before: unknown; after: unknown }[]
}

export interface SystemStatus {
  version: string
  runtime: string
  uptimeSeconds: number
  database: { provider: 'Postgres' | 'MySql' | 'Sqlite'; healthy: boolean; migrationVersion: string }
  mongo: { enabled: boolean; healthy: boolean }
  redis: { enabled: boolean; healthy: boolean }
}

/* ---------- errors ---------- */
export interface ProblemDetails {
  type?: string
  title?: string
  status: number
  detail?: string
  code: string
  traceId?: string
  errors?: Record<string, string[]>
}

/* ---------- speech queue (docs/api-contract-speech-setup.md §S1) ---------- */
export type SpeechSessionStatus = 'draft' | 'open' | 'running' | 'closed'
export type SpeechEntryStatus = 'queued' | 'speaking' | 'done' | 'skipped'
export type CoursewareKind = 'pptx' | 'ppt' | 'pdf' | 'web'
export type ConversionState = 'none' | 'converting' | 'ready' | 'failed'
export type PreviewMode = 'pdf' | 'pptx' | 'web' | 'none'

export interface PersonRef {
  id: Uuid
  displayName: string
  avatarUrl?: string
}

export interface TeamMember {
  userId: Uuid
  displayName: string
  avatarUrl?: string
  isLeader: boolean
}

export interface Courseware {
  id: Uuid
  entryId: Uuid
  kind: CoursewareKind
  originalName: string
  size: number
  conversion: ConversionState
  previewMode: PreviewMode
  uploadedAt: IsoDate
  uploader: PersonRef
}

export interface SpeechEntry {
  id: Uuid
  sessionId: Uuid
  position: number
  topic: string
  status: SpeechEntryStatus
  owner: PersonRef
  team?: { id: Uuid; name: string; members: TeamMember[] }
  courseware?: Courseware
  startedAt?: IsoDate
  finishedAt?: IsoDate
  mine: boolean
  version: number
}

export interface SpeechTeam {
  id: Uuid
  sessionId: Uuid
  name: string
  leaderId: Uuid
  members: TeamMember[]
  entryId?: Uuid
  /** Only returned to team members and speech.manage. */
  joinCode?: string
  mine: boolean
  version: number
}

export interface SpeechSession {
  id: Uuid
  title: string
  date: string // YYYY-MM-DD
  description: string
  slotMinutes: number
  allowTeams: boolean
  maxTeamSize: number
  submissionsOpen: boolean
  status: SpeechSessionStatus
  entryCount: number
  currentEntryId?: Uuid
  version: number
  createdAt: IsoDate
}

export interface SpeechSessionDetail extends SpeechSession {
  entries: SpeechEntry[]
  teams: SpeechTeam[]
  myEntryId?: Uuid
  myTeamId?: Uuid
}

export interface PreviewTicket {
  mode: PreviewMode
  /** Path relative to the site root, e.g. /api/v1/speech/preview/{token}/file */
  url: string
  expiresAt: IsoDate
  fileName: string
}

export interface Capabilities {
  pptConverter: boolean
  maxCoursewareMb: number
  allowedKinds: string[]
  defaults: { slotMinutes: number; allowTeams: boolean; maxTeamSize: number }
}

export interface SpeechSessionInput {
  title: string
  date: string
  description?: string
  slotMinutes?: number
  allowTeams?: boolean
  maxTeamSize?: number
}

/* ---------- setup wizard (§S3) ---------- */
export type SetupState = 'needs_database' | 'needs_admin' | 'ready'
export type DatabaseProvider = 'PostgreSql' | 'MySql' | 'Sqlite'

export interface SetupStatus {
  state: SetupState
  setupCompleted: boolean
  tokenRequired: boolean
  database: { provider: DatabaseProvider; configured: boolean; connected: boolean; error?: string }
  storage: { path: string; writable: boolean }
  converter: { available: boolean; command?: string }
  jwtKeyIsDefault: boolean
  environment: string
  version: string
  /** The server only allows SQLite in development and tests. */
  sqliteAllowed?: boolean
}

export interface DatabaseInput {
  provider: DatabaseProvider
  connectionString: string
}

export interface DatabaseTestResult {
  ok: boolean
  message?: string
  serverVersion?: string
}

export interface SetupAdminInput {
  username: string
  displayName: string
  password: string
  email?: string
}
