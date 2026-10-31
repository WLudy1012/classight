# 成员权限验证插件

成员身份扩展复用现有登录会话、角色和权限目录，不维护另一套角色，也不进行实名认证。管理员在插件管理中心启用 `member-identity` 后，登录用户可在班级中心查看当前账号的权限。

## 服务端接入

插件通过 `IModule.DeclarePermissions()` 声明权限，并确保模块参与应用启动时的模块注册。需要校验的路由可引用 `Classight.Class` 并使用：

```csharp
using Classight.Class;

endpoints.MapPost("/api/v1/example/action", Handler)
    .RequireMemberPermission("example.action");
```

扩展会要求有效登录，并在执行处理程序前验证插件已启用、权限已登记且当前会话有该权限。不满足时拒绝请求。也可注入 `Classight.Contracts.IMemberPermissionVerifier`，调用 `HasPermission(code, ct)` 或 `RequirePermission(code, ct)`。传入未知权限、未登录或插件停用均不会通过；需要依赖该扩展的功能应当处理拒绝访问。

这个能力不改变现有 `RequireAuthorization` 和其他系统权限检查。关闭插件只使通过此接口提供的扩展验证不可用，不能取消其他服务端授权。

## 前端接入

登录用户可从 `GET /api/v1/member-identity/permissions` 获取当前会话的已授予权限；停用时接口不可用。`useMemberPermissions()` 提供 React 查询结果，`useMemberPermission(code)` 返回 `allowed`，可用来决定是否显示控件。前端查询用于界面提示，不构成授权；操作接口仍必须在服务端校验权限。角色变更会影响服务端后续请求，客户端查询结果不能作为长期凭据。
