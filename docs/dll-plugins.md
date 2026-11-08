# DLL 插件开发与热重载

daemon 启动后创建同目录的 `plugin/`，并释放四个内置插件。将插件 DLL 放入此目录，后台扫描会自动加载；替换文件会切换到新版本，删除文件会卸载入口和接口。管理中心的运行状态显示加载结果。

```text
ClassightDaemon.exe
config/
data/
plugin/
  Classight.Speech.dll
  Classight.Captcha.dll
  Classight.Timetable.dll
  Classight.MemberIdentity.dll
  Classight.HelloPlugin.dll
```

DLL 从影子副本加载，因此 Windows 下也可替换原文件。更新候选版本未通过验证或启动失败时，旧版本继续提供服务；新版本接管请求后，旧版本等待正在处理的请求与跨插件调用完成，再停止后台服务和卸载。删除插件不会删除数据库记录。

## 编写插件

插件目标框架为 `net11.0`，使用与宿主匹配的 `Classight.SharedKernel`；需要通用能力时再引用 `Classight.Contracts`，需要现有数据库与平台服务时引用 `Classight.Platform`。不要引用其他业务插件 DLL。共享程序集由宿主提供，部署时无需复制。

实现具有公开无参构造函数的 `IPluginModule`，提供唯一的 `PluginManifest`，通过 `AddServices` 注册自己的服务与 `IManagedPlugin`，通过 `MapEndpoints` 注册接口，通过 `DeclarePermissions` 声明权限。

Minimal API 处理函数中的插件私有 DTO 必须标注 `[FromBody]`，私有服务必须标注 `[FromServices]`，均来自 `Microsoft.AspNetCore.Mvc`。不要对插件私有枚举或自定义类型使用隐式参数推断、`[AsParameters]` 或路径/查询绑定；可先绑定为宿主的字符串等基础类型，再自行解析。加载器会拒绝会把私有类型保留在 ASP.NET 全局绑定缓存中的参数声明。

```csharp
endpoints.MapPost("/api/v1/plugins/example/api/action",
    ([FromBody] ActionInput input, [FromServices] ActionService service) => service.Execute(input))
    .RequireAuthorization("example.action");
```

完整可构建示例见 [HelloPlugin](../examples/HelloPlugin/HelloPlugin.cs)。在仓库根目录执行：

```powershell
dotnet build examples/HelloPlugin -c Release
Copy-Item examples/HelloPlugin/bin/Release/net11.0/Classight.HelloPlugin.dll <daemon目录>/plugin/
```

示例提供独立页面和需要登录的 API。文件加载成功后，工作台自动出现 Hello plugin；点击页面按钮可通过宿主调用 DLL 中的接口。

`Manifest.Id` 使用 ASCII 字母、数字或连字符，且不能与其他插件重复。`WorkspacePath` 是相对 `/center` 的路径，例如 `hello`，不能使用保留的 `account` 路径。只有 API 的插件可以不提供工作台路径和 UI。`Permission` 可限制入口可见性，实际操作必须在接口上使用 `RequireAuthorization("permission.code")` 等服务端校验。

自定义权限加载后会加入权限目录，`SuperAdmin` 角色会同步获得新权限。其他角色仍由管理员分配。需要通用成员权限验证时，引用 `IMemberPermissionVerifier` 或 `RequireMemberPermission`，并在 `IManagedPlugin.Dependencies` 声明 `member-identity`，参见[成员权限插件](member-permission-plugin.md)。

## 独立页面

将页面资源设置为嵌入资源，逻辑名称以 `Classight.PluginUi.` 开头，例如：

```xml
<EmbeddedResource Include="index.html" LogicalName="Classight.PluginUi.index.html" />
<EmbeddedResource Include="assets/app.js" LogicalName="Classight.PluginUi.assets/app.js" />
```

`UiEntry` 填写完整地址 `/api/v1/plugins/<id>/ui/index.html`。资源 URL 对应嵌入资源路径，页面可以用相对地址加载 JS 和 CSS。静态资源允许匿名访问，不要在其中嵌入密钥或私有数据。

页面运行在 sandbox iframe 中，使用 `postMessage` 请求宿主调用自己的接口：

```js
parent.postMessage({
  type: 'classight:request',
  requestId: 'unique-request-id',
  method: 'GET',
  path: '/plugins/hello/api/status'
}, '*');
```

`path` 相对 `/api/v1`，必须位于当前插件的 `/plugins/<id>/api/` 下，支持 GET、POST、PUT、PATCH、DELETE，可用 `body` 发送 JSON。宿主验证消息来源和路径后附加当前会话凭据；不会把令牌交给 iframe。页面接收 `{ type: 'classight:response', requestId, ok: true, data }` 或 `ok: false` 的错误响应，务必校验 `event.source === parent`、消息类型与请求 ID。详细处理示例在 [index.html](../examples/HelloPlugin/index.html)。

## 依赖与生命周期

有私有依赖的插件放入一级子目录，例如 `plugin/my-plugin/`，将入口 DLL、依赖 DLL、`.deps.json` 和 `runtimes/` 一起部署。扫描器识别目录内实现 `IPluginModule` 的 DLL，普通依赖不会注册为插件。不同目录的插件各自加载私有依赖；共享契约、平台及宿主已有的 .NET/Microsoft 程序集由宿主提供，需保持版本兼容。

每代插件有独立的服务容器和 HTTP JSON 配置，支持普通 singleton、scoped、transient、工厂、开放泛型和 `IEnumerable<T>`。当前不支持 keyed DI。HTTP 请求有独立作用域；后台工作通过 `IHostedService`/`BackgroundService` 注册，必须响应取消，并在停止或释放时注销事件、定时器和静态引用。不要把插件类型传给宿主永久缓存，也不要创建无法停止的线程。

通用能力应定义在共享契约中，经宿主代理和调用租约访问，以便调用完成后卸载。可选插件不能成为核心账号、站点和数据库模块的程序集依赖。数据库结构变更仍需独立迁移；热替换 DLL 不会自动执行插件自定义迁移。

宿主 `/openapi/v1.json` 只收录核心接口，动态插件接口不进入其全局类型缓存。插件可自行提供接口文档。

先将新文件完整写入临时位置，再移动替换正式 DLL，可减少复制过程中的加载失败。`.cache/` 是运行时影子副本目录，不要放置自己的文件。运行中的旧版本可能仍持有副本，清理此目录前停止 daemon。

DLL 在 daemon 进程内执行，应仅安装可信代码。热卸载依赖插件主动释放资源；不配合的后台任务、外部引用或进程级缓存仍可能阻止回收，需要重启处理。
