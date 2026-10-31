import { del, get, getBlob, patch, post, put, uploadWithProgress } from './client'
import type {
  AdminMember,
  AdminUser,
  AuditLog,
  AuthResult,
  Capabilities,
  Courseware,
  DatabaseInput,
  DatabaseTestResult,
  ClassOverview,
  ClassProfile,
  ConsoleOverview,
  Invite,
  LoginRequest,
  MemberPublic,
  Page,
  PageQuery,
  Permission,
  PermissionGroup,
  RefreshResult,
  RegisterRequest,
  PreviewTicket,
  Role,
  SessionInfo,
  SettingsEnvelope,
  SettingsGroupKey,
  SettingsGroupMap,
  SetupAdminInput,
  SetupStatus,
  SitePublic,
  SpeechEntry,
  SpeechSession,
  SpeechSessionDetail,
  SpeechSessionInput,
  SpeechSessionStatus,
  SpeechTeam,
  SystemStatus,
  TimelineEvent,
  UserSelf,
  Uuid,
} from './types'

type Q = Record<string, string | number | boolean | undefined>

/** One function per contract endpoint (docs/api-contract.md). Features import from here only. */
export const siteApi = {
  public: () => get<SitePublic>('/site/public'),
}

export const authApi = {
  login: (b: LoginRequest) => post<AuthResult>('/auth/login', b),
  register: (b: RegisterRequest) => post<AuthResult>('/auth/register', b),
  /** The mock also returns `user` so the auth store restores a session in one call; the real backend may omit it. */
  refresh: () => post<RefreshResult & { user?: UserSelf }>('/auth/refresh', undefined, { noRefresh: true }),
  logout: () => post<void>('/auth/logout', undefined, { noRefresh: true }),
  logoutAll: () => post<void>('/auth/logout-all'),
  me: () => get<UserSelf>('/auth/me'),
  changePassword: (b: { currentPassword: string; newPassword: string }) => post<void>('/auth/password/change', b),
  sessions: () => get<SessionInfo[]>('/auth/sessions'),
  revokeSession: (id: Uuid) => del(`/auth/sessions/${id}`),
}

export const meApi = {
  profile: () => get<UserSelf>('/me/profile'),
  updateProfile: (b: { displayName?: string; bio?: string; email?: string; version: number }) =>
    patch<UserSelf>('/me/profile', b),
  /** The backend requires the profile version (If-Match) for optimistic concurrency. */
  uploadAvatar: (file: File, version: number) => {
    const fd = new FormData()
    fd.append('file', file)
    return put<{ avatarUrl: string }>('/me/avatar', fd, { headers: { 'If-Match': String(version) } })
  },
  deleteAvatar: (version: number) => del('/me/avatar', { headers: { 'If-Match': String(version) } }),
  console: () => get<ConsoleOverview>('/me/console'),
}

export const classApi = {
  overview: (signal?: AbortSignal) => get<ClassOverview>('/class/overview', undefined, signal),
  profile: () => get<ClassProfile>('/class/profile'),
  members: (q?: PageQuery) => get<Page<MemberPublic>>('/class/members', q as Q),
  timeline: (q?: PageQuery & { year?: number }) => get<Page<TimelineEvent>>('/class/timeline', q as Q),
  timelineEvent: (id: Uuid) => get<TimelineEvent>(`/class/timeline/${id}`),
}

export const adminApi = {
  // class
  updateClassProfile: (b: { motto: string; intro: string; foundedOn: string; version: number }) =>
    put<ClassProfile>('/admin/class/profile', b),
  members: (q?: PageQuery) => get<Page<AdminMember>>('/admin/class/members', q as Q),
  createMember: (b: { displayName: string; title?: string; joinedOn?: string; intro?: string }) =>
    post<AdminMember>('/admin/class/members', b),
  updateMember: (
    id: Uuid,
    b: { displayName: string; title?: string; joinedOn?: string; intro?: string; version: number },
  ) => put<AdminMember>(`/admin/class/members/${id}`, b),
  deleteMember: (id: Uuid) => del(`/admin/class/members/${id}`),
  linkMember: (id: Uuid, userId: Uuid) => post<AdminMember>(`/admin/class/members/${id}/link-user`, { userId }),
  unlinkMember: (id: Uuid) => post<AdminMember>(`/admin/class/members/${id}/unlink-user`),
  timeline: (q?: PageQuery) => get<Page<TimelineEvent>>('/admin/class/timeline', q as Q),
  createTimeline: (b: { title: string; summary?: string; body?: string; occurredOn: string; tags?: string[] }) =>
    post<TimelineEvent>('/admin/class/timeline', b),
  updateTimeline: (
    id: Uuid,
    b: { title: string; summary?: string; body?: string; occurredOn: string; tags?: string[] },
  ) => put<TimelineEvent>(`/admin/class/timeline/${id}`, b),
  deleteTimeline: (id: Uuid) => del(`/admin/class/timeline/${id}`),

  // users / roles / invites
  users: (q?: PageQuery & { role?: string; status?: string }) => get<Page<AdminUser>>('/admin/users', q as Q),
  user: (id: Uuid) => get<AdminUser>(`/admin/users/${id}`),
  createUser: (b: { username: string; displayName: string; password?: string; email?: string; roles?: string[] }) =>
    post<AdminUser & { temporaryPassword?: string }>('/admin/users', b),
  updateUser: (id: Uuid, b: { displayName?: string; email?: string; version: number }) =>
    patch<AdminUser>(`/admin/users/${id}`, b),
  disableUser: (id: Uuid) => post<AdminUser>(`/admin/users/${id}/disable`),
  enableUser: (id: Uuid) => post<AdminUser>(`/admin/users/${id}/enable`),
  resetPassword: (id: Uuid) => post<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`),
  setUserRoles: (id: Uuid, roleIds: Uuid[]) => put<AdminUser>(`/admin/users/${id}/roles`, { roleIds }),
  deleteUser: (id: Uuid) => del(`/admin/users/${id}`),
  roles: () => get<Role[]>('/admin/roles'),
  createRole: (b: { name: string; description?: string; permissions: Permission[] }) => post<Role>('/admin/roles', b),
  updateRole: (id: Uuid, b: { name: string; description?: string; permissions: Permission[] }) =>
    put<Role>(`/admin/roles/${id}`, b),
  deleteRole: (id: Uuid) => del(`/admin/roles/${id}`),
  permissions: () => get<PermissionGroup[]>('/admin/permissions'),
  invites: (q?: PageQuery) => get<Page<Invite>>('/admin/invites', q as Q),
  createInvite: (b: { role?: string; maxUses?: number; expiresAt?: string; code?: string }) =>
    post<Invite>('/admin/invites', b),
  deleteInvite: (id: Uuid) => del(`/admin/invites/${id}`),

  // settings / audit / system
  settings: () => get<SettingsEnvelope[]>('/admin/settings'),
  settingsGroup: <K extends SettingsGroupKey>(g: K) => get<SettingsEnvelope<K>>(`/admin/settings/${g}`),
  saveSettings: <K extends SettingsGroupKey>(g: K, values: Partial<SettingsGroupMap[K]>, version: number) =>
    put<SettingsEnvelope<K>>(`/admin/settings/${g}`, { values, version }),
  auditLogs: (q?: PageQuery & { actor?: string; action?: string; resourceType?: string; from?: string; to?: string }) =>
    get<Page<AuditLog>>('/admin/audit-logs', q as Q),
  auditLog: (id: Uuid) => get<AuditLog>(`/admin/audit-logs/${id}`),
  systemStatus: () => get<SystemStatus>('/admin/system/status'),
  clearCache: () => post<void>('/admin/system/cache/clear'),
}

/** Class meeting queue (docs/api-contract-speech-setup.md §S1). */
export const speechApi = {
  capabilities: () => get<Capabilities>('/speech/capabilities'),
  sessions: (q?: PageQuery & { status?: SpeechSessionStatus }) => get<Page<SpeechSession>>('/speech/sessions', q as Q),
  session: (id: Uuid, signal?: AbortSignal) => get<SpeechSessionDetail>(`/speech/sessions/${id}`, undefined, signal),
  signUp: (sessionId: Uuid, b: { topic: string; teamId?: Uuid }) => post<SpeechEntry>(`/speech/sessions/${sessionId}/entries`, b),
  updateEntry: (id: Uuid, b: { topic: string; version: number }) => patch<SpeechEntry>(`/speech/entries/${id}`, b),
  deleteEntry: (id: Uuid) => del(`/speech/entries/${id}`),
  createTeam: (sessionId: Uuid, b: { name: string }) => post<SpeechTeam>(`/speech/sessions/${sessionId}/teams`, b),
  joinTeam: (b: { code: string }) => post<SpeechTeam>('/speech/teams/join', b),
  removeMember: (teamId: Uuid, userId: Uuid) => del(`/speech/teams/${teamId}/members/${userId}`),
  disbandTeam: (teamId: Uuid) => del(`/speech/teams/${teamId}`),
  /** Upload or replace; `onProgress` receives bytes sent / total. */
  uploadCourseware: (entryId: Uuid, file: File, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal) =>
    uploadWithProgress<Courseware>(`/speech/entries/${entryId}/courseware`, file, onProgress, signal),
  courseware: (id: Uuid) => get<Courseware>(`/speech/courseware/${id}`),
  downloadCourseware: (id: Uuid) => getBlob(`/speech/courseware/${id}/download`),
  previewTicket: (id: Uuid) => post<PreviewTicket>(`/speech/courseware/${id}/preview-ticket`),
  deleteCourseware: (id: Uuid) => del(`/speech/courseware/${id}`),

  // speech.manage
  adminSessions: (q?: PageQuery & { status?: SpeechSessionStatus }) => get<Page<SpeechSession>>('/admin/speech/sessions', q as Q),
  createSession: (b: SpeechSessionInput) => post<SpeechSession>('/admin/speech/sessions', b),
  updateSession: (id: Uuid, b: SpeechSessionInput & { submissionsOpen: boolean; version: number }) =>
    put<SpeechSession>(`/admin/speech/sessions/${id}`, b),
  deleteSession: (id: Uuid) => del(`/admin/speech/sessions/${id}`),
  setStatus: (id: Uuid, status: SpeechSessionStatus) => post<SpeechSession>(`/admin/speech/sessions/${id}/status`, { status }),
  setOrder: (id: Uuid, entryIds: Uuid[]) => put<SpeechSessionDetail>(`/admin/speech/sessions/${id}/order`, { entryIds }),
  startEntry: (id: Uuid) => post<SpeechEntry>(`/admin/speech/entries/${id}/start`),
  finishEntry: (id: Uuid) => post<SpeechEntry>(`/admin/speech/entries/${id}/finish`),
  skipEntry: (id: Uuid) => post<SpeechEntry>(`/admin/speech/entries/${id}/skip`),
  signUpFor: (sessionId: Uuid, b: { topic: string; ownerId: Uuid; teamId?: Uuid }) =>
    post<SpeechEntry>(`/admin/speech/sessions/${sessionId}/entries`, b),
}

/** First-run wizard (§S3). Everything except `complete` is anonymous and guarded by the setup token. */
const tok = (token?: string) => (token ? { headers: { 'X-Setup-Token': token } } : undefined)
export const setupApi = {
  status: () => get<SetupStatus>('/setup/status'),
  testDatabase: (b: DatabaseInput, token?: string) => post<DatabaseTestResult>('/setup/database/test', b, tok(token)),
  applyDatabase: (b: DatabaseInput, token?: string) => post<SetupStatus>('/setup/database', b, tok(token)),
  createAdmin: (b: SetupAdminInput, token?: string) => post<AuthResult>('/setup/admin', b, tok(token)),
  complete: () => post<void>('/setup/complete'),
}
