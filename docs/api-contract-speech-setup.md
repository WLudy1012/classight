# Classight 接口契约 v1.1：班会演讲排队 + Setup 向导

本文是 `api-contract.md` 的增补，规则相同（基础路径 `/api/v1`、camelCase、ISO-8601、ProblemDetails + `code`、分页 `{items,total,page,pageSize}`、乐观并发 `version`）。**先改本文再改代码**，前后端以此为准。

## S0. 新增权限码
| 权限 | 默认角色 | 说明 |
|---|---|---|
| `speech.participate` | Member、Admin、SuperAdmin | 报名排队、组队、上交/替换自己的课件 |
| `speech.manage` | Admin、SuperAdmin | 场次 CRUD、调序、状态控制、代为报名/删除条目、查看全部课件 |

已有数据库的内置角色（Member/Admin/SuperAdmin）在启动时**幂等补齐**新权限。

## S0.1 新增错误码
| HTTP | code | 含义 |
|---|---|---|
| 409 | `speech.already_signed_up` | 本场次已有条目（单人或经队伍） |
| 409 | `speech.team_full` | 队伍已满（`maxTeamSize`） |
| 409 | `speech.team_exists` | 已在本场次的另一支队伍里 |
| 409 | `speech.speaking_exists` | 已有正在演讲的条目 |
| 403 | `speech.closed` | 场次未开放报名 / 已结束 |
| 403 | `speech.not_leader` | 需要队长权限 |
| 403 | `speech.teams_disabled` | 本场次不允许组队 |
| 422 | `courseware.unsupported_type` | 不是 pptx/ppt/pdf/含 index.html 的 zip |
| 413 | `courseware.too_large` | 超过 `maxCoursewareMb` |
| 422 | `courseware.invalid_archive` | zip 损坏 / 路径穿越 / 条目或解压量超限 / 缺 index.html |
| 401 | `preview.token_invalid` | 预览签名无效或已过期 |
| 503 | `setup.required` | 系统尚未完成 setup（除 `/setup/**`、`/health/**` 外的接口） |
| 403 | `setup.forbidden` | setup 已完成 / Setup Token 错误 |
| 422 | `setup.database_unreachable` | 数据库连接失败（信息已脱敏） |

## S1. 班会场次与排队（登录后可读；写操作按权限）

### 数据结构
```
SpeechSession { id, title, date(YYYY-MM-DD), description, slotMinutes, allowTeams, maxTeamSize,
                submissionsOpen, status: 'draft'|'open'|'running'|'closed',
                entryCount, currentEntryId?, version, createdAt }
SpeechSessionDetail = SpeechSession & { entries: SpeechEntry[](按 position), teams: SpeechTeam[],
                                        myEntryId?, myTeamId? }
SpeechEntry { id, sessionId, position, topic, status: 'queued'|'speaking'|'done'|'skipped',
              owner: PersonRef, team?: { id, name, members: TeamMember[] },
              courseware?: Courseware, startedAt?, finishedAt?, mine: boolean, version }
SpeechTeam  { id, sessionId, name, leaderId, members: TeamMember[], entryId?, joinCode?, mine: boolean, version }
              // joinCode 只对队伍成员与 speech.manage 返回
PersonRef   { id, displayName, avatarUrl? }
TeamMember  { userId, displayName, avatarUrl?, isLeader }
Courseware  { id, entryId, kind: 'pptx'|'ppt'|'pdf'|'web', originalName, size,
              conversion: 'none'|'converting'|'ready'|'failed',
              previewMode: 'pdf'|'pptx'|'web'|'none', uploadedAt, uploader: PersonRef }
PreviewTicket { mode: 'pdf'|'pptx'|'web'|'none', url, expiresAt, fileName }
              // url 是相对站点根的路径，如 /api/v1/speech/preview/{token}/file 或 .../site/index.html
Capabilities { pptConverter: boolean, maxCoursewareMb, allowedKinds: string[],
               defaults: { slotMinutes, allowTeams, maxTeamSize } }
```
`previewMode` 规则：pdf→`pdf`；web→`web`；pptx→转换器可用且 `conversion=ready` 时 `pdf`，否则 `pptx`（客户端渲染）；ppt→转换器可用且 ready 时 `pdf`，否则 `none`（仅下载）。

### 接口
| 方法 路径 | 说明 | 权限 |
|---|---|---|
| GET `/speech/capabilities` | 能力与默认值 | 登录 |
| GET `/speech/sessions?status&page&pageSize` | 场次列表（`date` 倒序）；非 manage 看不到 `draft` | 登录 |
| GET `/speech/sessions/{id}` | `SpeechSessionDetail` | 登录（draft 仅 manage） |
| POST `/speech/sessions/{id}/entries` `{topic, teamId?}` | 报名。带 `teamId` 须是该队队长，以队伍名义占一个条目；否则个人条目 | `speech.participate`，场次 `open` 且 `submissionsOpen` |
| PATCH `/speech/entries/{id}` `{topic, version}` | 改主题 | 本人/队长 或 manage |
| DELETE `/speech/entries/{id}` | 取消条目（删除其课件文件） | 本人/队长 或 manage |
| POST `/speech/sessions/{id}/teams` `{name}` | 建队（自己成为队长；返回含 `joinCode`） | `speech.participate`，`allowTeams` |
| POST `/speech/teams/join` `{code}` | 凭加入码入队 | `speech.participate` |
| DELETE `/speech/teams/{id}/members/{userId}` | 队长踢人 / 本人退队 / manage；队长不能退队（须解散或转让） | 见左 |
| DELETE `/speech/teams/{id}` | 解散队伍（同时删除其条目与课件） | 队长 或 manage |
| POST `/speech/entries/{id}/courseware` multipart `file` | 上交/替换课件，返回 `Courseware`（201） | 条目所有者/队长/队员 或 manage |
| GET `/speech/courseware/{id}` | 元数据 | 登录 |
| GET `/speech/courseware/{id}/download` | 下载原文件（`Content-Disposition: attachment`） | 登录 |
| POST `/speech/courseware/{id}/preview-ticket` | 返回 `PreviewTicket`（10 分钟签名） | 登录 |
| DELETE `/speech/courseware/{id}` | 删除课件 | 同上传 |
| GET `/speech/preview/{token}/file` | pdf / pptx 原文件，支持 Range；匿名，凭路径签名 | 签名 |
| GET `/speech/preview/{token}/site/{**path}` | 网页项目静态文件；空 path = 入口 html | 签名 |

约束：同场次一人只能有一个条目（单人或经队伍）；同一时间只能有一个 `speaking`；条目 `position` 从 1 起连续。上传上限取设置 `speech.maxCoursewareMb`（默认 50）。

### 管理（`speech.manage`）
| 方法 路径 | 说明 |
|---|---|
| GET `/admin/speech/sessions` | 同 `/speech/sessions` 但含 draft |
| POST `/admin/speech/sessions` `{title,date,description?,slotMinutes?,allowTeams?,maxTeamSize?}` | 新建（默认 `draft`，默认值取 `speech` 设置组） |
| PUT `/admin/speech/sessions/{id}` `{...,submissionsOpen,version}` | 修改 |
| DELETE `/admin/speech/sessions/{id}` | 软删除 |
| POST `/admin/speech/sessions/{id}/status` `{status}` | 状态流转：`draft→open→running→closed`，允许 `open⇄running`、`closed→open` |
| PUT `/admin/speech/sessions/{id}/order` `{entryIds:[...]}` | 整体设置队列顺序（必须恰为该场次全部 `queued` 条目） |
| POST `/admin/speech/entries/{id}/start` / `finish` / `skip` | 开始（需无其他 speaking）/ 完成 / 跳过；返回条目 |
| POST `/admin/speech/sessions/{id}/entries` `{topic, ownerId, teamId?}` | 代为报名 |

所有写操作进审计：`speech.session.*`、`speech.entry.*`、`speech.team.*`、`courseware.*`。

### 实时
首批用前端轮询（场次页 5s）。预留 SignalR 事件名：`speech.session.updated`、`speech.entry.updated`、`courseware.updated`。

## S2. 设置组 `speech`
`GET/PUT /admin/settings/speech`，值：`{ defaultSlotMinutes: 5, allowTeams: true, maxTeamSize: 4, maxCoursewareMb: 50 }`（`1≤slot≤60`，`2≤maxTeamSize≤20`，`1≤maxCoursewareMb≤200`）。

## S3. Setup 向导（匿名可达，直至完成后锁定）
状态：`needs_database`（未配置/连不上）→ `needs_admin`（库就绪、无用户）→ `ready`。`ready` 且 `setupCompleted=false` 表示管理员已创建但向导未走完（用管理员令牌继续后续步骤）。用 `Bootstrap:Password` 预置管理员的部署视为 `setupCompleted=true`。

非 `ready` 时，除 `/setup/**`、`/health/**` 外的 `/api/v1/*` 返回 503 `setup.required`。`setupCompleted=true` 后全部 setup 写接口返回 403 `setup.forbidden`。

```
SetupStatus { state: 'needs_database'|'needs_admin'|'ready', setupCompleted: boolean, tokenRequired: boolean,
              database: { provider: 'PostgreSql'|'MySql'|'Sqlite', configured: boolean, connected: boolean, error? },
              storage:  { path, writable },
              converter:{ available, command? },
              jwtKeyIsDefault: boolean, environment: string, version }
```
| 方法 路径 | 说明 | 认证 |
|---|---|---|
| GET `/setup/status` | 环境与进度 | 匿名 |
| POST `/setup/database/test` `{provider, connectionString}` → `{ok, message?, serverVersion?}` | 仅测试，不保存；错误脱敏 | `X-Setup-Token`，状态 `needs_database` |
| POST `/setup/database` `{provider, connectionString}` → `SetupStatus` | 写 `appsettings.Local.json`（Provider/连接串/AutoMigrate=true/随机 Jwt:Key），运行迁移与种子，**无需重启** | `X-Setup-Token`，状态 `needs_database` |
| POST `/setup/admin` `{username, displayName, password, email?}` → `AuthResult` | 创建超级管理员并登录 | `X-Setup-Token`，状态 `needs_admin` |
| POST `/setup/complete` → 204 | 标记完成并锁定 | Bearer，`SuperAdmin` |

`X-Setup-Token`：首次启动时随机生成，打印到后端控制台并写 `data/setup-token.txt`；`tokenRequired=true` 时前端第一步让用户粘贴。其余向导步骤复用 `/admin/settings/{site|appearance|security|speech}`、`/admin/invites`。

## S4. `/me/console` 快捷入口
追加 `{ key: 'queue', label: 'console.queue', route: '/queue', permission: 'speech.participate' }`；后端 `label` 一律为前端 i18n key（不再返回中文字面量），`route` 为前端实际路由。

## S5. 前端路由
`/queue`（场次列表）、`/queue/:sessionId`（场次详情）、`/setup`（向导，全屏）；管理端 `/admin/speech`（班会场次）。
