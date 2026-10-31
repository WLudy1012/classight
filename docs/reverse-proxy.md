# 前端反向代理

Classight 后端可用 YARP 将页面、静态资源和 WebSocket 转发到一个固定的前端服务，同时继续处理本机 API 和健康检查。没有配置时，后端沿用 `wwwroot/` 静态文件托管，不需要代理服务。

通过配置项 `FrontendProxy:Address` 设置前端服务的 HTTP(S) 源地址，例如 `http://127.0.0.1:5173`。也可设置环境变量：

```powershell
$env:FrontendProxy__Address = "http://127.0.0.1:5173"
```

重启后端后访问后端地址即可；本机运行 Vite 时使用 `pnpm dev --host 127.0.0.1`，前端应配置 `VITE_API_MODE=http`。浏览器的 `/api` 请求由后端直接处理，不经过前端服务。`/health` 与 `/api` 下未匹配的路径返回本机 404。启用代理后不读取 `wwwroot/`；上游不可用时返回网关错误，不会自动切换到可能过期的静态文件。

只允许配置包含协议、主机及可选端口的绝对源地址，不接受用户信息、路径、查询参数或片段。上游固定由部署者指定，请将其指向可信的前端服务，避免指向后端自身；代理会检测直接循环。转发仅支持 GET、HEAD 和基于 GET 的 WebSocket，且不会向前端上游发送 `Authorization`、`Cookie`，也不会将上游的 `Set-Cookie` 返回给浏览器。API 请求和登录 Cookie 均由后端处理。

生产部署中应由 HTTPS 入口终止 TLS，并限制上游网络访问。YARP 的此接入用于前端流量，不提供按用户输入选择目标、通用外网代理或服务发现功能。
