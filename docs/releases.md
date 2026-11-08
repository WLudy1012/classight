# 安装与自动更新

从 [GitHub Releases](https://github.com/WLudy1012/classight/releases/latest) 下载对应平台的文件。

| 平台 | 下载文件 | 启动方式 |
| --- | --- | --- |
| Windows x64 | `Classight-Windows-x64.zip` | 解压到可写目录，双击 `Start-Classight.cmd`。包内包含 .NET 运行时。 |
| Linux x64 | `ClassightDaemon-linux-x64` | 安装 .NET 11 RC2 ASP.NET Core 运行时，执行 `chmod +x ClassightDaemon-linux-x64`，再启动该文件。 |

首次启动后访问 [http://localhost:5080](http://localhost:5080)，按安装向导创建管理员并连接数据库。服务从程序所在目录读取 `config/`、`data/` 和 `plugin/`。

## 更新如何生效

发布版启动后自动检查同一 GitHub 仓库的最新稳定 Release，运行期间会定期复查。发现更高版本时，程序下载当前平台的二进制文件，并校验发布附带的 SHA-256。下载失败或校验不通过时，服务继续运行当前版本。

- Windows 会暂存更新。停止服务后，通过 `Start-Classight.cmd` 再次启动时安装。演示包使用随包的 `启动演示.cmd`。首次从旧版迁移时，停止服务并把新版 ZIP 中的 EXE、启动脚本和更新助手放到原安装目录。
- Linux 在运行期间原子替换磁盘上的程序文件。当前进程继续提供服务，下一次重启运行新版本。

更新保留现有配置、数据库和自定义插件。程序所在目录需要允许服务账号写入，才能下载并安装更新。

如需固定版本，在 `config/appsettings.json` 中将 `Updates.Enabled` 设为 `false` 并重启。

```json
{
  "Updates": {
    "Enabled": false
  }
}
```

## 发布新版本

先推送 `vMAJOR.MINOR.PATCH` 格式的 Git 标签，再从仓库的 Actions 页面运行 `Release` 工作流，输入该标签。也可以通过 GitHub CLI 启动工作流。

```sh
git tag v1.0.1
git push origin v1.0.1
gh workflow run release.yml -f tag=v1.0.1
```

工作流从标签构建 Windows 自包含程序、Windows ZIP 和 Linux 程序，并生成对应的 `.sha256` 文件。所有文件上传至草稿 Release 后，工作流再公开该版本并将它标记为最新稳定版。

本地构建使用 `global.json` 指定的 SDK、Node.js 24、pnpm 10 和 PowerShell 7。脚本将版本写入程序，并把文件放在 `dist/releases/v1.0.1/`。

```powershell
./scripts/Build-Release.ps1 -Version 1.0.1
```

已有为 HTTP API 构建的前端 ZIP 时，可用 `-FrontendArchive` 复用。ZIP 根目录应包含 `index.html`。
