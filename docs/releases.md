# 安装与自动更新

从 [GitHub Releases](https://github.com/WLudy1012/classight/releases/latest) 下载对应平台的文件。

| 平台 | 下载文件 | 启动方式 |
| --- | --- | --- |
| Windows x64 | `Classight-Windows-x64.zip` 或 `ClassightDaemon-win-x64.exe` | ZIP 解压后运行 `Start-Classight.cmd`；单 EXE 可直接启动。两者都包含 .NET 运行时。 |
| Linux x64 | `ClassightDaemon-linux-x64` | 安装 ASP.NET Core 11.0.0 或更高的 11.0 正式版运行时，执行 `chmod +x ClassightDaemon-linux-x64`，再启动该文件。 |

首次启动后访问 [http://localhost:5080](http://localhost:5080)，按安装向导创建管理员并连接数据库。服务从程序所在目录读取 `config/`、`data/` 和 `plugin/`。

从 v1.0.x 升级的 Linux 用户需要先安装 [ASP.NET Core 11 正式版运行时](https://dotnet.microsoft.com/en-us/download/dotnet/11.0)，再重启至新版。RC2 无法运行 v1.1.0。Windows 自包含包已包含所需运行时。

## 更新如何生效

发布版启动后自动检查同一 GitHub 仓库的最新稳定 Release，默认每六小时复查。发现更高版本时，程序下载当前平台的二进制文件，并校验发布附带的 SHA-256 和 GitHub 记录的文件摘要。下载失败或校验不通过时，服务继续运行当前版本，默认 15 分钟后重试。

- Windows 从 v1.1.0 起自带更新助手，单 EXE 启动也支持更新。更新下载完成后，后台助手等待当前进程退出，再校验并替换程序。正常停止程序，等待退出后的替换完成，再次启动即使用新版。`Start-Classight.cmd` 仍可在启动前安装待处理的更新。首次从旧版迁移时，可停止服务并把新版 ZIP 中的 EXE、启动脚本和更新助手放到原安装目录。
- Linux 在运行期间备份旧程序，然后原子替换磁盘上的程序文件。当前进程继续提供服务，下一次重启运行新版本。systemd 部署可执行 `sudo systemctl restart classight`。

管理后台的“系统状态 → 程序更新”显示运行版本、发现的新版本、下载进度、失败原因、下次检查时间和重启提示。拥有 `system.read` 权限可查看；拥有 `system.manage` 权限可手动检查。检查和下载在后台进行，重复请求不会创建并行更新。开发模式和 `dotnet Classight.Api.dll` 启动方式不进行自动更新。

更新保留现有配置、数据库和自定义插件。程序所在目录需要允许服务账号写入，才能下载并安装更新。

旧程序保存在安装目录下的 `data/updates/ClassightDaemon.previous.exe`（Windows）或 `data/updates/ClassightDaemon.previous`（Linux）。如需恢复，先关闭自动更新并停止服务，再将备份复制回原可执行文件路径。该备份只包含程序，不包含数据库；涉及数据结构变化时，还需使用兼容的数据库备份。系统不会因新版本启动失败而自动回退数据库。

如需固定版本，在 `config/appsettings.json` 中将 `Updates.Enabled` 设为 `false` 并重启。

```json
{
  "Updates": {
    "Enabled": false,
    "CheckIntervalMinutes": 360,
    "RetryIntervalMinutes": 15,
    "DownloadTimeoutMinutes": 10
  }
}
```

配置文件位于程序旁的 `config/`，修改后重启生效。`CheckIntervalMinutes` 支持 5–10080 分钟，`RetryIntervalMinutes` 支持 1–1440 分钟，`DownloadTimeoutMinutes` 支持 1–60 分钟。首次启动生成的配置包含这些选项。关闭更新也会阻止 Windows 安装已暂存的更新；Linux 已替换到磁盘的版本仍会在下次启动时运行。

## 发布新版本

先推送 `vMAJOR.MINOR.PATCH` 格式的 Git 标签，再从仓库的 Actions 页面运行 `Release` 工作流，输入该标签。也可以通过 GitHub CLI 启动工作流。

```sh
git tag v1.1.0
git push origin v1.1.0
gh workflow run release.yml -f tag=v1.1.0
```

工作流从标签构建 Windows 自包含程序、Windows ZIP 和 Linux 程序，并生成对应的 `.sha256` 文件。所有文件上传至草稿 Release 后，工作流再公开该版本并将它标记为最新稳定版。

本地构建使用 `global.json` 指定的 SDK、Node.js 24、pnpm 10 和 PowerShell 7。脚本将版本写入程序，并把文件放在 `dist/releases/v1.1.0/`。

```powershell
./scripts/Build-Release.ps1 -Version 1.1.0
```

已有为 HTTP API 构建的前端 ZIP 时，可用 `-FrontendArchive` 复用。ZIP 根目录应包含 `index.html`。
