# Classight 后端

后端按 `docs/api-contract.md` 的 `/api/v1` 契约实现，运行时为 .NET 11 RC2。项目按模块拆分：

- `Classight.SharedKernel`：模块接口、权限、当前用户、统一输入校验。
- `Classight.Platform`：EF Core 数据模型、缓存、限流、事件审计、媒体存储。
- `Classight.Identity`：登录、刷新令牌轮换、注册、会话、用户和角色管理。
- `Classight.Class`：班级资料、成员、绑定账号、时间线。
- `Classight.Content`：媒体上传和受保护读取。
- `Classight.SiteAdmin`：公开站点数据、设置、健康检查、审计和系统状态。
- `Classight.Api`：组合模块、JWT、ProblemDetails、OpenAPI 和启动初始化。

## 本地启动

设置连接字符串和随机 JWT 密钥。生产环境不要使用仓库内 `appsettings.json` 的开发密钥。

```powershell
$env:ConnectionStrings__Main = "Host=localhost;Database=classight;Username=postgres;Password=..."
$env:Jwt__Key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$env:Bootstrap__Username = "admin"
$env:Bootstrap__Password = "替换为强密码"
$env:Database__Provider = "PostgreSql"
$env:Database__AutoMigrate = "true"
F:/classight/.tools/dotnet/dotnet.exe run --project backend/src/Classight.Api
```

MySQL 使用 `Database__Provider=MySql`，并将 `ConnectionStrings__Main` 设置为 MySQL 连接字符串。SQLite 只允许 Development/Testing。

MongoDB 和 Redis 默认关闭；启用时分别设置 `Mongo__Enabled=true`、`ConnectionStrings__Mongo`、`Mongo__Database`，以及 `Redis__Enabled=true`、`ConnectionStrings__Redis`。Mongo 只替换审计和活动流存储，Redis 替换缓存、锁和限流。

首次启动空库时必须提供 `Bootstrap__Password`；启动会创建 `SuperAdmin`、`Admin`、`Member` 内置角色和默认站点设置。生产部署建议使用迁移而不是自动迁移：

```powershell
$env:CLASSIGHT_DB_PROVIDER = "PostgreSql"
$env:CLASSIGHT_DB_CONNECTION = $env:ConnectionStrings__Main
F:/classight/.tools/ef/dotnet-ef.exe database update --project backend/src/Classight.Platform --startup-project backend/src/Classight.Api
```

## 安全边界

- 访问令牌仅返回 JSON；刷新令牌只放 `HttpOnly + Secure + SameSite=Strict` Cookie。
- 修改资源必须提供 `version` 或 `If-Match`，冲突返回 `resource.version_mismatch`。
- 文件上传检查扩展声明、MIME 和文件签名；私有媒体不泄露存在性。
- 管理员不能授予自身没有的权限，不能删除系统角色或最后一个可用 SuperAdmin。
- 公开 GET 返回 ETag；错误统一 RFC 7807 ProblemDetails。
- 非 GET 的 `/auth/*` 请求校验 `Origin`：必须同源或在 `Security:AllowedOrigins` 白名单内。Development 环境放行任意 Origin（本地、局域网或公网试用），因此 `pnpm dev` 的 vite 代理和直接用 IP 访问都开箱即用；生产环境跨域部署需显式配置 `Security:AllowedOrigins__0=https://your-site`。

## 单进程托管前端（无需反向代理）

把前端构建产物（`web/dist`）放到**内容根目录下的 `wwwroot/`**，后端会同时托管页面与静态资源，一个进程一个端口即可对外服务：

```
backend/
  appsettings.json
  wwwroot/          <- 前端构建产物（index.html + assets/）
  Classight.Api
```

- 内容根目录 = **启动时的工作目录**。`appsettings.json` 与 `wwwroot/` 必须能从同一个工作目录读到，所以要在 `backend/` 目录内启动进程（`cd backend && ./Classight.Api`）。
- 路由规则：`/api/**` 与 `/health/**` 始终走 API（未知路由返回 RFC 7807 ProblemDetails 404）；其余路径命中静态文件则直接返回，否则回退到 `wwwroot/index.html` 交给前端路由。
- `wwwroot/assets/**` 是内容哈希产物，响应带 `Cache-Control: public, max-age=31536000, immutable`；`index.html` 始终 `no-cache`。
- 没有 `wwwroot/` 时后端保持纯 API 行为（所有未匹配路由返回 404 JSON），集成测试即依赖这一行为。
- 监听地址由 `ASPNETCORE_URLS` 决定（默认只听 `localhost:5000`）；对外服务需显式设置，例如 `ASPNETCORE_URLS=http://0.0.0.0:5080`。

## 首次运行与密钥

- 全新安装（数据库尚未配置）时若未提供 `Jwt:Key`，后端会回退到开发默认密钥并打印警告，**保证能启动进入 Setup 向导**；向导完成时会把生成的随机密钥写入 `appsettings.Local.json`。数据库已配置却缺少密钥属于部署误配，后端仍会直接失败退出。
- Setup 期间的 `503 setup.required` 是门禁的正常响应（前端会自动跳转到 `/setup`），日志级别为 Debug，不会在默认日志级别下刷错误堆栈。

## 人机验证密钥

在管理后台的「插件管理」中配置 Cloudflare Turnstile、阿里云验证码 2.0 或腾讯云验证码，再启用人机验证。配置前保留一个管理员登录会话，并在服务商控制台核对站点域名；启用后登录和注册均要求完成验证。服务商不可用或验证失败时请求会被拒绝。

服务商密钥使用 ASP.NET Core Data Protection 加密后存储。生产环境可设置 `DataProtection__KeyDirectory` 指向可持久化、仅应用账号可访问的目录；多实例需使用同一个目录和密钥环。自定义目录中的密钥文件需要通过文件系统权限及适当的存储加密保护。备份并保留该目录：密钥环丢失或改变后，已保存的服务商密钥无法解密，需要通过保留的管理员会话重新配置。模拟 API 不提供真实人机验证，不能启用该插件。

## 测试隔离

集成测试运行在 `Testing` 环境：该环境**不加载** `appsettings.Local.json`，测试工厂自行固定全部配置，因此本机开发配置不会影响 `dotnet test` 的结果。
