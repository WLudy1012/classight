# Classight 接口契约 v1（草案）

本文档是前后端共同遵守的契约。后端实现时 OpenAPI 必须与之一致；如需变更，先改本文档再改代码。M0 评审通过后冻结 v1。

## A. HTTP API 通用约定
- 基础路径 `/api/v1`；JSON，字段 camelCase；时间 ISO-8601 UTC；ID 为 GUID（v7，可排序）；枚举序列化为字符串。
- 认证：`Authorization: Bearer <accessToken>`；刷新令牌仅在 HttpOnly + Secure + SameSite=Strict Cookie（路径 `/api/v1/auth`）。前端访问令牌只存内存。
- 分页：请求 `page`（从 1）、`pageSize`（默认 20，最大 100）、`sort`（如 `-createdAt,name`）；响应 `{ items[], total, page, pageSize }`。
- 乐观并发：可编辑资源返回 `version`（或 ETag）；更新必须带 `If-Match`/`version`，不匹配返回 409。
- 错误：统一 RFC 7807 ProblemDetails，扩展字段 `code`（机器可读）、`traceId`、`errors`（字段级校验 `{field:[msg]}`）。
- 限流：超限返回 429 + `Retry-After`；登录/注册/重置密码使用更严格策略。
- 缓存：公开 GET 返回 `ETag`/`Cache-Control`，前端用 TanStack Query 管理。
- 里程碑列标记该接口在哪个阶段交付（M1…M6，"后续"= 预留不在首批）。

## B. 错误码（`code`）
| HTTP | code | 含义 |
|---|---|---|
| 400 | `validation.failed` | 参数校验失败（带 `errors`） |
| 401 | `auth.invalid_credentials` / `auth.token_expired` / `auth.token_invalid` | 凭据错误 / 令牌过期 / 令牌无效 |
| 403 | `permission.denied` / `auth.account_disabled` | 无权限 / 账号被禁用 |
| 404 | `resource.not_found` | 资源不存在 |
| 409 | `resource.conflict` / `resource.version_mismatch` / `user.already_exists` | 冲突 / 版本不匹配 / 用户已存在 |
| 410 | `invite.expired` | 邀请码过期 |
| 422 | `invite.invalid` / `password.too_weak` / `media.unsupported_type` | 业务规则不满足 |
| 423 | `auth.account_locked` | 多次失败被锁定 |
| 429 | `rate.limited` | 触发限流 |
| 500/503 | `server.error` / `dependency.unavailable` | 服务器错误 / 依赖不可用 |

## C. 权限码（permission）与默认角色矩阵
权限码：`site.settings.read` `site.settings.write` `class.profile.write` `class.members.manage` `class.timeline.manage` `content.manage` `media.upload` `users.read` `users.manage` `roles.manage` `invites.manage` `audit.read` `system.read` `system.manage`。
默认角色：`Member` = `media.upload`；`Admin` = Member + `class.*` + `content.manage` + `users.read` + `users.manage` + `invites.manage` + `site.settings.read` + `audit.read`；`SuperAdmin` = 全部（含 `roles.manage`、`site.settings.write`、`system.*`，不可删除）。角色可在后台自定义。每个模块通过 `DeclarePermissions` 注册自己的权限，启动时汇总到 `GET /admin/permissions`。

## D. 公共与站点（匿名可访问）
| 方法 路径 | 说明 | 请求 | 响应 | 里程碑 |
|---|---|---|---|---|
| GET `/site/public` | 站点公开信息，主页启动第一个请求 | — | `className`、`classNameEn?`、`slogan`、`appearance{particleQualityDefault, palette, fontSubsetUrl}`、`registrationMode(invite\|closed)`、`apiVersion`、`features{mongo,redis}`(仅布尔，不暴露细节) | M1/M2 |
| GET `/health/live` `/health/ready` | 存活/就绪（不带 `/api/v1`） | — | 状态与依赖项 | M1 |

## E. 认证与账号（`/auth`）
| 方法 路径 | 说明 | 请求 | 响应 | 权限 | 里程碑 |
|---|---|---|---|---|---|
| POST `/auth/login` | 登录 | `{account(用户名或邮箱), password}` | `{accessToken, expiresIn, user: UserSelf}` + Set-Cookie 刷新令牌 | 匿名 | M4 |
| POST `/auth/register` | 邀请码注册 | `{inviteCode, username, displayName, password, email?}` | 同登录 | 匿名（受 `registrationMode` 限制） | M4 |
| POST `/auth/refresh` | 刷新访问令牌（令牌轮换） | Cookie | `{accessToken, expiresIn}` | 匿名（需有效刷新 Cookie） | M4 |
| POST `/auth/logout` | 注销当前会话，吊销刷新令牌 | — | 204 | 登录 | M4 |
| POST `/auth/logout-all` | 注销所有设备 | — | 204 | 登录 | M4 |
| GET `/auth/me` | 当前用户 + 权限 | — | `UserSelf`（含 `roles[]`、`permissions[]`） | 登录 | M4 |
| POST `/auth/password/change` | 修改密码 | `{currentPassword, newPassword}` | 204，其他会话失效 | 登录 | M4 |
| POST `/auth/password/forgot` / `reset` | 找回密码（仅在配置了邮件发送时启用） | `{email}` / `{token, newPassword}` | 202 / 204 | 匿名 | 后续 |
| GET `/auth/sessions` | 我的登录会话 | — | `[{id, device, ip, createdAt, lastSeenAt, current}]` | 登录 | M4 |
| DELETE `/auth/sessions/{id}` | 吊销指定会话 | — | 204 | 登录 | M4 |
| GET `/auth/external/{provider}` | 第三方登录（预留） | — | 重定向 | 匿名 | 后续 |

## F. 当前用户与用户控制台（`/me`，对应主页 "start"）
| 方法 路径 | 说明 | 请求 | 响应 | 里程碑 |
|---|---|---|---|---|
| GET `/me/profile` | 个人资料 | — | `UserSelf`：`{id, username, displayName, avatarUrl, email?, bio, roles[], permissions[], createdAt, version}` | M4 |
| PATCH `/me/profile` | 修改资料 | `{displayName?, bio?, email?, version}` | `UserSelf` | M4 |
| PUT `/me/avatar` | 上传头像（multipart，限类型/大小） | file | `{avatarUrl}` | M4 |
| DELETE `/me/avatar` | 删除头像 | — | 204 | M4 |
| GET `/me/console` | 控制台首页聚合 | — | `{user, linkedMember?(班级成员档案), shortcuts[{key,label,route,permission?}], unreadNotifications}`（`shortcuts` 由后端按权限下发，前端无需硬编码） | M4 |
| GET `/me/notifications` | 通知列表（分页） | `unreadOnly?` | 分页 `Notification{id,type,title,body,createdAt,readAt?}` | 后续 |
| POST `/me/notifications/{id}/read` `/read-all` | 标记已读 | — | 204 | 后续 |

## G. 班级信息（`/class`，信息页数据源）
| 方法 路径 | 说明 | 响应 | 权限 | 里程碑 |
|---|---|---|---|---|
| GET `/class/overview` | **信息页一次性聚合**（滚轮推进动画期间预取，减少往返） | `{profile, stats{memberCount, timelineCount, foundedYears}, membersPreview[≤12], latestTimeline[≤5]}` | 匿名（可由设置改为需登录） | M3 |
| GET `/class/profile` | 班级资料 | `ClassProfile{id, name, nameEn?, motto, intro(markdown), foundedOn, coverUrl, version}` | 同上 | M3 |
| GET `/class/members` | 成员（分页，`q`、`role`筛选） | `MemberPublic{id, displayName, avatarUrl, title?, joinedOn?, intro?}` | 同上 | M3 |
| GET `/class/members/{id}` | 成员详情 | `MemberPublic` + 扩展字段 | 同上 | M3 |
| GET `/class/timeline` | 时间线（`year`、分页，按时间倒序） | `TimelineEvent{id, title, summary, occurredOn, coverUrl?, tags[]}` | 同上 | M3 |
| GET `/class/timeline/{id}` | 事件详情 | `TimelineEvent` + `body(markdown)`、`media[]` | 同上 | M3 |

## H. 内容与媒体（预留，`Content` 模块）
| 方法 路径 | 说明 | 权限 | 里程碑 |
|---|---|---|---|
| POST `/media` | 上传媒体（multipart）→ `{id, url, contentType, size}` | `media.upload` | M4 |
| GET `/media/{id}` | 读取媒体（私有时需鉴权，公开资源走静态/CDN） | 视资源 | M4 |
| GET `/content/announcements`、`/content/announcements/{id}` | 公告 | 匿名/登录 | 后续 |
| GET `/content/albums`、`/content/albums/{id}` | 相册 | 匿名/登录 | 后续 |

## I. 管理后台（`/admin/**`，全部需登录 + 对应权限）
### 班级内容管理
| 方法 路径 | 说明 | 权限 | 里程碑 |
|---|---|---|---|
| PUT `/admin/class/profile` | 修改班级资料（带 `version`） | `class.profile.write` | M5 |
| GET `/admin/class/members` | 成员档案列表（含未绑定账号者） | `class.members.manage` | M5 |
| POST `/admin/class/members` | 新增成员档案 | 同上 | M5 |
| PUT/DELETE `/admin/class/members/{id}` | 修改/删除（软删除） | 同上 | M5 |
| POST `/admin/class/members/{id}/link-user` `/unlink-user` | 绑定/解绑站点账号 | 同上 | M5 |
| POST `/admin/class/timeline`、PUT/DELETE `/admin/class/timeline/{id}` | 时间线增删改 | `class.timeline.manage` | M5 |

### 用户、角色、邀请
| 方法 路径 | 说明 | 权限 | 里程碑 |
|---|---|---|---|
| GET `/admin/users` | 用户列表（`q`、`role`、`status`、分页） | `users.read` | M5 |
| GET `/admin/users/{id}` | 用户详情 | `users.read` | M5 |
| POST `/admin/users` | 管理员创建用户 `{username, displayName, password?, roles[]}` | `users.manage` | M5 |
| PATCH `/admin/users/{id}` | 修改资料 | `users.manage` | M5 |
| POST `/admin/users/{id}/disable` `/enable` | 禁用/启用（禁用即吊销全部会话） | `users.manage` | M5 |
| POST `/admin/users/{id}/reset-password` | 重置密码（返回一次性临时密码） | `users.manage` | M5 |
| PUT `/admin/users/{id}/roles` | 整体设置角色 `{roleIds[]}` | `users.manage` | M5 |
| DELETE `/admin/users/{id}` | 软删除 | `users.manage` | M5 |
| GET/POST `/admin/roles`、GET/PUT/DELETE `/admin/roles/{id}` | 角色管理 `{name, description, permissions[]}`（系统内置角色不可删） | `roles.manage` | M5 |
| GET `/admin/permissions` | 权限目录（按模块分组） | `roles.manage` | M5 |
| GET/POST `/admin/invites`、DELETE `/admin/invites/{id}` | 邀请码 `{code, role, maxUses, expiresAt, usedCount}`（`expiresAt` 可省略，省略即永不过期；响应中永不过期的邀请码 `expiresAt` 为 `null`） | `invites.manage` | M5 |

### 站点设置、审计、系统
| 方法 路径 | 说明 | 权限 | 里程碑 |
|---|---|---|---|
| GET `/admin/settings` | 全部设置分组 | `site.settings.read` | M5 |
| GET/PUT `/admin/settings/{group}` | 分组读写，`group` ∈ `site`（名称、口号）/`appearance`（粒子档位、配色）/`security`（注册模式、密码策略、会话时长）/`storage`（媒体存储）；写入需带 `version` | read / `site.settings.write` | M5 |
| GET `/admin/audit-logs` | 审计日志（`actor`、`action`、`resourceType`、`from`、`to`、分页） | `audit.read` | M5 |
| GET `/admin/audit-logs/{id}` | 详情（含变更前后差异） | `audit.read` | M5 |
| GET `/admin/system/status` | `{version, runtime, uptime, database{provider, healthy, migrationVersion}, mongo{enabled, healthy}, redis{enabled, healthy}}` | `system.read` | M5（Mongo/Redis 状态 M6）|
| POST `/admin/system/cache/clear` | 清缓存 | `system.manage` | M6 |

## J. 实时通道（可选，后续）
SignalR Hub `/hubs/app`（JWT 鉴权；多实例且启用 Redis 时用 Redis 背板）。服务端→客户端事件：`notification.created`、`session.revoked`（被踢下线）、`settings.changed`（站点设置变更，前端失效相关缓存）。首批不实现，仅预留 Hub 与事件名。

## K. 后端内部接口（端口，业务只依赖这些）
| 端口 | 位置 | 默认实现 | 可选/替换实现 |
|---|---|---|---|
| `IClock` / `ICurrentUser` | SharedKernel | 系统时钟 / 从 HttpContext 取 | 测试替身 |
| `ICacheService`（基于 HybridCache）| Platform | 进程内 | Redis L2 |
| `IDistributedLock` | Platform | 进程内锁 | Redis 锁 |
| `IRateLimitStore` | Platform | 进程内 | Redis |
| `IEventBus`（领域/集成事件）| Platform | 进程内 | 以后可换 Redis Stream/消息队列 |
| `IAuditStore` | Platform | 关系库表 | Mongo 集合 |
| `IActivityStore`（活动流）| Platform | 关系库表 | Mongo 集合 |
| `IMediaStorage` | Platform | 本地磁盘 | S3/OSS 兼容 |
| `ISettingsStore` | SiteAdmin | 关系库（版本化）| — |
| `IEmailSender` | Platform | Noop（未配置则相关功能自动禁用）| SMTP |
| `INotificationDispatcher` | Platform | 写库 | + SignalR 推送 |
| `IPermissionCatalog` | Identity | 汇总各模块声明 | — |
| `IModule` | SharedKernel | `Name`、`AddServices`、`MapEndpoints`、`DeclarePermissions` | 每个模块实现一个 |

模块间契约（`*.Contracts` 项目）：`IIdentityQueries`（按 ID 取用户摘要）、`IClassProfileQueries`（供 `/me/console` 取绑定成员档案）、`ISiteSettingsReader`（只读设置）。领域事件：`UserRegistered`、`UserDisabled`、`UserRolesChanged`、`ClassProfileUpdated`、`MemberLinked`、`SettingChanged`（审计与缓存失效都订阅事件，业务代码不直接调用）。

## L. 前端内部接口
| 接口 | 位置 | 约定 |
|---|---|---|
| API 客户端 | `shared/api` | 由 OpenAPI 生成，手写代码只做拦截器：注入 Bearer、401 时静默刷新一次并重放、统一把 ProblemDetails 转成 `ApiError{code, status, errors, traceId}` |
| Auth Store | `features/auth` | 状态 `{status: anonymous\|authenticated\|refreshing, user, accessToken(内存)}`；提供 `can(permission)`、`useRequirePermission()`；页面刷新时先调 `/auth/refresh` 恢复会话 |
| 主页阶段状态机 | `features/home/stage` | 状态：`intro → idle → locked → transitioning → info`；事件：`POINTER_LOCK`、`POINTER_UNLOCK`、`WHEEL(delta)`、`KEY_DOWN/UP`、`ESC`、`QUALITY_DOWNGRADE`；上下文：`progress(0..1)`、`quality`；3D、光标、DOM 只订阅，不各自维护阶段 |
| 吸附注册表 `MagnetRegistry` | `features/home/cursor` | `register({id, kind: dom\|scene, getScreenRect(), radius, priority, onSnap, onRelease})` → 返回注销函数；DOM 元素可用属性 `data-magnet`、`data-magnet-radius`、`data-magnet-priority` 自动注册；3D 班级名称每帧把包围盒投影成屏幕矩形后更新 |
| 光标状态 `CursorState` | 同上 | `mode: idle\|hover\|snapped\|expanding`、`rect`、`velocity`；弹簧参数（质量/刚度/阻尼）来自 motion tokens |
| 粒子场景配置 `ParticleSceneConfig` | `features/home/scene` | `{text, fontUrl, quality(high\|medium\|low\|static), particleCount, spring, noise, repelRadius, repelStrength, palette}`，其中 `text/palette/quality 默认值` 来自 `/site/public` |
| 质量探测 `QualityDetector` | `shared/perf` | 输入：GPU/WebGL 能力、设备像素比、`prefers-reduced-motion`、帧时间滑窗；输出档位，掉帧自动降级并通知状态机 |
| 动画令牌 `motion tokens` | `shared/motion` | 命名的缓动与弹簧预设（如 `snap`、`expand`、`panelIn`），所有动画只引用名称，不写散落的曲线数值 |
| 毛玻璃卡片 `GlassCard` | `shared/ui` | 属性：`blur`、`tint`、`elevation`；`backdrop-filter` 不支持时降级为半透明纯色 |
| 后台注册表 `registerAdminModule` | `features/admin/registry` | `{id, routes[], menu{label, icon, order, requiredPermission}, permissions[]}`；后台壳按当前用户权限渲染菜单与路由 |
| 环境配置 | `web/.env*` | `VITE_API_BASE`（默认同源 `/api/v1`）、`VITE_ENABLE_DEVTOOLS`；不放任何密钥 |

## M. 接口与页面/功能对应（便于核对无遗漏）
| 前端功能 | 使用的接口 |
|---|---|
| 主页启动（粒子文字、配色、档位默认值）| `GET /site/public` |
| 右上角登录/头像 | `POST /auth/login`、`POST /auth/refresh`、`GET /auth/me`、`POST /auth/logout` |
| 滚轮推进→班级信息页 | `GET /class/overview`（预取）、必要时 `GET /class/members`、`GET /class/timeline` |
| 右下角 "start" 用户控制台 | `GET /me/console`、`/me/profile`、`PUT /me/avatar`、`/auth/sessions`、`/auth/password/change` |
| 注册 | `POST /auth/register` |
| 管理后台各页 | 第 I 节全部 |


> 增补：班会演讲排队与 Setup 向导见 [api-contract-speech-setup.md](api-contract-speech-setup.md)。
