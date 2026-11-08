#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$DotnetPath,
    [string]$FrontendArchive,
    [string]$PublishedExecutable,
    [string]$Version = '1.0.0',
    [switch]$SkipFrontendBuild,
    [switch]$BuildOnly,
    [switch]$FinalizeOnly,
    [string]$Password = 'ClassightDemo2026!',
    [string]$ListenUrl = 'http://0.0.0.0:5080'
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist/Classight-Windows-Demo' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory, $projectRoot)
if ($BuildOnly -and $FinalizeOnly) { throw 'BuildOnly and FinalizeOnly cannot be combined.' }
if ($Password.Length -lt 12) { throw 'Choose a demonstration password with at least 12 characters.' }
if ($PublishedExecutable) {
    $PublishedExecutable = [IO.Path]::GetFullPath($PublishedExecutable, $projectRoot)
    if (-not (Test-Path -LiteralPath $PublishedExecutable -PathType Leaf)) {
        throw "Published executable does not exist: $PublishedExecutable"
    }
}
$listenUri = [Uri]$ListenUrl
if ($listenUri.Scheme -notin @('http', 'https')) { throw 'ListenUrl must be an HTTP or HTTPS address.' }
$browserUrl = '{0}://localhost:{1}' -f $listenUri.Scheme, $listenUri.Port
$utf8 = [Text.UTF8Encoding]::new($false)

function Write-DemoFiles([switch]$PreserveAccounts) {
    $launch = @"
@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
echo Classight Windows 演示版
echo 启动后在浏览器打开 $browserUrl
echo 演示账号密码见同目录的「账号密码.txt」。
echo 按 Ctrl+C 停止服务，演示过程中请保持窗口打开。
echo.
call ".\Start-Classight.cmd"
echo.
echo 服务已停止。若启动失败，请保留窗口中的错误信息。
pause
popd
endlocal
"@
    [IO.File]::WriteAllText((Join-Path $OutputDirectory '启动演示.cmd'), ($launch -replace "`r?`n", "`r`n"), $utf8)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Classight.cmd'), (Join-Path $PSScriptRoot 'Apply-ClassightUpdate.ps1') -Destination $OutputDirectory -Force
    $accounts = @"
Classight Windows 演示账号

访问地址：$browserUrl

管理员：admin
教师：teacher
学生：student
以上账号密码均为：$Password

这些是演示包专用账号，密码按要求明文保存在本文件。
如需对外长期部署，请修改各账号密码。
"@
    $accountsFile = Join-Path $OutputDirectory '账号密码.txt'
    if (-not $PreserveAccounts -or -not (Test-Path -LiteralPath $accountsFile)) { [IO.File]::WriteAllText($accountsFile, $accounts, $utf8) }
    $readme = @"
Classight Windows x64 演示包

1. 把压缩包完整解压到可写目录。
2. 双击「启动演示.cmd」，保持服务窗口打开。
3. 浏览器访问 $browserUrl，使用「账号密码.txt」中的账号登录。
4. 演示结束后回到服务窗口，按 Ctrl+C 停止。

已包含 .NET 运行时、网站前端、SQLite 数据库和四个内置 DLL 插件。
无需安装 .NET、Node.js、PostgreSQL、MySQL 或 Redis，无需运行安装向导。
演示内容包括班级资料、成员、时间线、课程表、班会与课件；人机验证保持关闭。
管理员可演示插件开关、成员权限和班会管理，学生可体验班会报名及课件预览。

配置文件：config\appsettings.json
监听地址：$ListenUrl，可修改 Urls 后重启。
本机访问：$browserUrl
同一局域网设备可用本机 IP 与端口 $($listenUri.Port) 访问；Windows 防火墙需允许该端口。
数据库：data\classight-demo.db
业务文件：data\media
插件目录：plugin，放入、替换或删除插件 DLL 后会自动加载更新。
运行时解压目录：data\bundle，由启动脚本设置，停止服务后可删除并在下次启动时重新生成。

运行时会检查 GitHub Releases 并下载可用的稳定更新。再次双击启动脚本时安装已下载的更新。
配置文件中设置 "Updates": { "Enabled": false } 可以关闭自动更新。

此包使用 Demo:Enabled 显式启用本地 SQLite，服务仍运行在 Production 环境。
PPT/PPTX 转 PDF 仍需另装 LibreOffice；包内网页课件可直接预览。
数据、账号变更会保存到本目录；需要恢复初始演示状态时，重新解压原压缩包到新目录。
请勿在服务运行时移动目录或复制数据库文件。

本包源码快照：Classight-source.zip，包含生成此包时的当前项目源码。
项目地址：https://github.com/WLudy1012/classight，在线仓库可能与本包源码快照不同。
许可证：GNU Affero General Public License v3.0，详见 LICENSE。
"@
    [IO.File]::WriteAllText((Join-Path $OutputDirectory '演示说明.txt'), $readme, $utf8)
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $OutputDirectory 'LICENSE') -Force
    $walkthrough = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'demo/演示路线.txt')).Replace('{{BROWSER_URL}}', $browserUrl)
    [IO.File]::WriteAllText((Join-Path $OutputDirectory '演示路线.txt'), $walkthrough, $utf8)
}

if ($FinalizeOnly) {
    $archivePath = $OutputDirectory.TrimEnd('\', '/') + '.zip'
    if (Test-Path -LiteralPath $archivePath) { throw "Archive already exists: $archivePath" }
    $configFile = Join-Path $OutputDirectory 'config/appsettings.json'
    $databaseFile = Join-Path $OutputDirectory 'data/classight-demo.db'
    $seedManifest = Join-Path $OutputDirectory 'data/demo-seed.json'
    if (-not (Test-Path -LiteralPath $databaseFile) -or (Get-Item -LiteralPath $databaseFile).Length -eq 0) { throw 'The demonstration database has not been initialized.' }
    if (-not (Test-Path -LiteralPath $seedManifest)) { throw 'Seed the demonstration data first; data/demo-seed.json is missing.' }
    $processes = Get-Process -Name ClassightDaemon -ErrorAction SilentlyContinue
    foreach ($process in $processes) {
        if ($process.Path -eq (Join-Path $OutputDirectory 'ClassightDaemon.exe')) { throw 'Stop the demonstration daemon before finalizing the package.' }
    }
    if ($PublishedExecutable -and $PublishedExecutable -ne (Join-Path $OutputDirectory 'ClassightDaemon.exe')) {
        Copy-Item -LiteralPath $PublishedExecutable -Destination (Join-Path $OutputDirectory 'ClassightDaemon.exe') -Force
    }
    $configuration = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json -AsHashtable
    $ListenUrl = [string]$configuration.Urls
    $listenUri = [Uri]$ListenUrl
    $browserUrl = '{0}://localhost:{1}' -f $listenUri.Scheme, $listenUri.Port
    $configuration.Remove('Bootstrap') | Out-Null
    [IO.File]::WriteAllText($configFile, ($configuration | ConvertTo-Json -Depth 12), $utf8)
    Write-DemoFiles -PreserveAccounts
    $assetsPath = Join-Path $projectRoot 'backend/src/Classight.Api/obj/project.assets.json'
    if (Test-Path -LiteralPath $assetsPath) {
        $assets = Get-Content -LiteralPath $assetsPath -Raw | ConvertFrom-Json -AsHashtable
        foreach ($framework in $assets.project.frameworks.Values) {
            foreach ($dependency in $framework.downloadDependencies | Where-Object name -in @('Microsoft.NETCore.App.Runtime.win-x64', 'Microsoft.AspNetCore.App.Runtime.win-x64')) {
                $version = $dependency.version.Trim('[', ']').Split(',')[0].Trim()
                foreach ($cache in $assets.packageFolders.Keys) {
                    $runtimePath = Join-Path $cache ($dependency.name.ToLowerInvariant() + '/' + $version)
                    if (-not (Test-Path -LiteralPath $runtimePath)) { continue }
                    $licensePath = Join-Path $OutputDirectory ('licenses/' + $dependency.name.ToLowerInvariant())
                    New-Item -ItemType Directory -Path $licensePath -Force | Out-Null
                    Get-ChildItem -LiteralPath $runtimePath -File | Where-Object { $_.Name -like 'LICENSE*' -or $_.Name -like 'THIRD-PARTY-NOTICES*' } | Copy-Item -Destination $licensePath -Force
                }
            }
        }
    }
    $sourceArchivePath = Join-Path $OutputDirectory 'Classight-source.zip'
    $sourceTemporary = $sourceArchivePath + '.building-' + [Guid]::NewGuid().ToString('N')
    $sourceList = & git -C $projectRoot ls-files -z --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate the current project source with git.' }
    $sourceFiles = ($sourceList -join "`n").Split([char]0, [StringSplitOptions]::RemoveEmptyEntries) | Sort-Object -Unique
    $sourceArchive = [IO.Compression.ZipFile]::Open($sourceTemporary, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relative in $sourceFiles) {
            $path = [IO.Path]::GetFullPath($relative, $projectRoot)
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($sourceArchive, $path, $relative.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally { $sourceArchive.Dispose() }
    [IO.File]::Move($sourceTemporary, $sourceArchivePath, $true)
    $prefix = (Split-Path -Leaf $OutputDirectory) + '/'
    $temporaryArchive = $archivePath + '.building-' + [Guid]::NewGuid().ToString('N')
    $archive = [IO.Compression.ZipFile]::Open($temporaryArchive, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $OutputDirectory -File -Recurse -Force) {
            $relative = [IO.Path]::GetRelativePath($OutputDirectory, $file.FullName).Replace('\', '/')
            if ($relative.StartsWith('data/bundle/') -or $relative.StartsWith('data/updates/') -or $relative.StartsWith('plugin/.cache/') -or $relative -match '(^|/)\.[^/]+/\.cache/' -or $file.Extension -eq '.log') { continue }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, ($prefix + $relative), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally { $archive.Dispose() }
    [IO.File]::Move($temporaryArchive, $archivePath)
    Write-Output "Demo folder: $OutputDirectory"
    Write-Output "Demo archive: $archivePath"
    exit
}

if (Test-Path -LiteralPath $OutputDirectory) { throw "Output directory already exists; choose a new path: $OutputDirectory" }
if (-not $PublishedExecutable) {
    if (-not $DotnetPath) {
        $localDotnet = Join-Path $projectRoot '.tools/dotnet/dotnet.exe'
        $DotnetPath = if (Test-Path -LiteralPath $localDotnet) { $localDotnet } else { (Get-Command dotnet -ErrorAction Stop).Source }
    }
    $buildDirectory = Join-Path $projectRoot ('dist/demo-build/' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
    if (-not $FrontendArchive) {
        $webDirectory = Join-Path $projectRoot 'web'
        if (-not $SkipFrontendBuild) {
            $previousMode = $env:VITE_API_MODE
            try {
                $env:VITE_API_MODE = 'http'
                Push-Location -LiteralPath $webDirectory
                try { & pnpm build; if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' } }
                finally { Pop-Location }
            }
            finally { $env:VITE_API_MODE = $previousMode }
        }
        $frontendDirectory = Join-Path $webDirectory 'dist'
        if (-not (Test-Path -LiteralPath (Join-Path $frontendDirectory 'index.html'))) { throw 'No built frontend found.' }
        $FrontendArchive = Join-Path $buildDirectory 'frontend.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($frontendDirectory, $FrontendArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
    }
    $FrontendArchive = [IO.Path]::GetFullPath($FrontendArchive, $projectRoot)
    if (-not (Test-Path -LiteralPath $FrontendArchive)) { throw "Frontend archive does not exist: $FrontendArchive" }
    $publishDirectory = Join-Path $buildDirectory 'publish'
    Push-Location -LiteralPath $projectRoot
    try {
        & $DotnetPath publish 'backend/src/Classight.Api/Classight.Api.csproj' -c Release -r win-x64 --self-contained true "-p:Version=$Version" '-p:PublishSingleFile=true' '-p:IncludeNativeLibrariesForSelfExtract=true' '-p:DebugType=None' '-p:DebugSymbols=false' '-p:ClassightStandalone=true' "-p:ClassightFrontendArchive=$FrontendArchive" -o $publishDirectory --verbosity quiet
        if ($LASTEXITCODE -ne 0) { throw 'Windows self-contained publish failed.' }
    }
    finally { Pop-Location }
    $PublishedExecutable = Join-Path $publishDirectory 'Classight.Api.exe'
}
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'config') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'data') -Force | Out-Null
Copy-Item -LiteralPath $PublishedExecutable -Destination (Join-Path $OutputDirectory 'ClassightDaemon.exe')
$configuration = [ordered]@{
    Urls = $ListenUrl
    Demo = @{ Enabled = $true }
    Database = @{ Provider = 'Sqlite'; AutoMigrate = $false }
    ConnectionStrings = @{ Main = 'Data Source=data/classight-demo.db' }
    Jwt = @{ Issuer = 'classight'; Audience = 'classight-web'; Key = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)) }
    Bootstrap = @{ Username = 'admin'; Password = $Password }
    Storage = @{ LocalPath = 'data/media' }
    Logging = @{ LogLevel = @{ Default = 'Information'; 'Microsoft.AspNetCore' = 'Warning'; 'Microsoft.EntityFrameworkCore.Database.Command' = 'Warning' } }
}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'config/appsettings.json'), ($configuration | ConvertTo-Json -Depth 12), $utf8)
Write-DemoFiles
Write-Output "Published self-contained daemon: $OutputDirectory"
Write-Output 'Start the daemon, run scripts/Initialize-DemoData.ps1 against it, stop the daemon, then run this script with -FinalizeOnly.'
