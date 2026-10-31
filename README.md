# Classight

Classight 是一个面向班级的自托管网站，包含公开班级信息、成员控制台、插件式班级中心和管理后台。前端使用 React、TypeScript 和 Three.js，后端使用 ASP.NET Core 和 .NET。

班级中心的功能以插件注册，包含班会报名、课件和课程表。管理后台提供成员、角色权限、站点设置和插件管理。登录与注册可配置 Cloudflare Turnstile、阿里云验证码或腾讯云验证码。仓库中的示例班级资料和模拟账号仅用于演示，部署前应替换。

## 开始开发

需要 Node.js 24、pnpm 10 和 [global.json](global.json) 指定的 .NET 11 SDK 预览版。后端正式部署使用 PostgreSQL 或 MySQL；MongoDB 和 Redis 为可选依赖。

### 仅运行前端

```sh
cd web
pnpm install --frozen-lockfile
pnpm dev
```

默认使用浏览器本地模拟 API，无需启动后端。演示账号为 `admin / Admin123!`、`teacher / Teacher123!`、`student / Student123!`，邀请码为 `CLASS2026`。这些凭据仅适用于模拟数据。

### 连接后端

在项目根目录启动后端：

```sh
dotnet run --project backend/src/Classight.Api
```

在 `web` 中将 `.env.example` 复制为 `.env.local`，设置 `VITE_API_MODE=http`，然后启动前端。开发服务器默认将 `/api/v1` 转发至 `localhost:5080`；请让后端监听该地址，或根据实际环境调整配置。首次运行时打开页面，按照 Setup 向导配置数据库并创建管理员。

部署配置、数据库和密钥管理见[后端说明](backend/README.md)，前端配置见[前端说明](web/README.md)。

## 验证

```sh
cd web
pnpm test
pnpm build
cd ..
dotnet test Classight.slnx
```

## 文档

- [API 契约](docs/api-contract.md)和[班会及安装接口](docs/api-contract-speech-setup.md)
- [班级中心插件](docs/class-center-plugins.md)与[成员权限验证插件](docs/member-permission-plugin.md)
- [课程表插件](docs/timetable-plugin.md)
- [YARP 前端反向代理](docs/reverse-proxy.md)
- [贡献指南](CONTRIBUTING.md)与[安全问题报告](SECURITY.md)

## 许可证

本项目使用 [GNU Affero General Public License v3.0](LICENSE)。
