#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$CurrentExecutable,
    [Parameter(Mandatory)][string]$NextExecutable
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = Join-Path $projectRoot ('dist/update-smoke/' + [Guid]::NewGuid().ToString('N') + '/安装目录 with spaces')
$updates = Join-Path $root 'data/updates'
New-Item -ItemType Directory -Path $updates, (Join-Path $root 'config'), (Join-Path $root 'plugin') -Force | Out-Null
$installed = Join-Path $root 'ClassightDaemon-custom.exe'
$pending = Join-Path $updates 'ClassightDaemon.pending.exe'
$manifest = Join-Path $updates 'pending.json'
$config = Join-Path $root 'config/appsettings.json'
$helperExecutable = Join-Path $updates 'ClassightDaemon.updater.exe'
Copy-Item -LiteralPath $NextExecutable -Destination $helperExecutable
Copy-Item -LiteralPath $CurrentExecutable -Destination $installed
Copy-Item -LiteralPath $NextExecutable -Destination $pending
$currentVersion = ([Diagnostics.FileVersionInfo]::GetVersionInfo($installed).ProductVersion -split '\+')[0]
$nextVersion = ([Diagnostics.FileVersionInfo]::GetVersionInfo($pending).ProductVersion -split '\+')[0]
if ([version]$nextVersion -le [version]$currentVersion) { throw 'The smoke test requires a newer target executable.' }
$oldHash = (Get-FileHash -LiteralPath $installed).Hash
$newHash = (Get-FileHash -LiteralPath $pending).Hash
@{ version = $nextVersion; currentVersion = $currentVersion; sha256 = $newHash.ToLowerInvariant(); executableName = [IO.Path]::GetFileName($installed) } |
    ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8
'{"Updates":{"Enabled":false},"smoke":"preserve-me"}' | Set-Content -LiteralPath $config -Encoding utf8
'custom plugin' | Set-Content -LiteralPath (Join-Path $root 'plugin/custom.keep')
& $helperExecutable --apply-update $root ([IO.Path]::GetFileName($installed)) 0 0
if ($LASTEXITCODE -ne 0) { throw 'The native installer failed to read the disabled update setting.' }
if ((Get-FileHash -LiteralPath $installed).Hash -ne $oldHash -or -not (Test-Path -LiteralPath $manifest)) { throw 'Disabled updates modified the installation.' }
'{"Updates":{"Enabled":true},"smoke":"preserve-me"}' | Set-Content -LiteralPath $config -Encoding utf8
$configHash = (Get-FileHash -LiteralPath $config).Hash
$waiting = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', 'ping -n 5 127.0.0.1 >nul' -WindowStyle Hidden -PassThru
$helper = $null
try {
    $start = [Diagnostics.ProcessStartInfo]::new($helperExecutable)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.Environment['DOTNET_BUNDLE_EXTRACT_BASE_DIR'] = Join-Path $root 'data/bundle'
    foreach ($argument in @('--apply-update', $root, [IO.Path]::GetFileName($installed),
        [string]$waiting.Id, [string]$waiting.StartTime.ToUniversalTime().Ticks)) {
        $start.ArgumentList.Add($argument)
    }
    $helper = [Diagnostics.Process]::Start($start)
    Start-Sleep -Milliseconds 500
    if ((Get-FileHash -LiteralPath $installed).Hash -ne $oldHash) { throw 'Installer replaced the program before its process exited.' }
    if (-not $helper.WaitForExit(60000)) { throw 'Installer did not complete after process exit.' }
    if ($helper.ExitCode -ne 0 -or (Get-FileHash -LiteralPath $installed).Hash -ne $newHash) { throw 'Pending update was not installed.' }
    if ((Get-FileHash -LiteralPath (Join-Path $updates 'ClassightDaemon.previous.exe')).Hash -ne $oldHash) { throw 'The previous executable was not preserved.' }
    if (Test-Path -LiteralPath $manifest) { throw 'The applied update manifest was not removed.' }
    if ((Get-FileHash -LiteralPath $config).Hash -ne $configHash -or (Get-Content -LiteralPath (Join-Path $root 'plugin/custom.keep')) -ne 'custom plugin') { throw 'The update changed configuration or plugins.' }
    Write-Output "Windows update smoke test passed: $currentVersion -> $nextVersion"
}
finally {
    if ($null -ne $helper) { if (-not $helper.HasExited) { $helper.Kill() }; $helper.Dispose() }
    if (-not $waiting.HasExited) { $waiting.Kill() }
    $waiting.Dispose()
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
Copy-Item -LiteralPath $CurrentExecutable -Destination $installed -Force
Copy-Item -LiteralPath $NextExecutable -Destination $pending
@{ version = $nextVersion; currentVersion = $currentVersion; sha256 = ('0' * 64); executableName = [IO.Path]::GetFileName($installed) } |
    ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8
& $helperExecutable --apply-update $root ([IO.Path]::GetFileName($installed)) 0 0
if ($LASTEXITCODE -ne 1 -or (Get-FileHash -LiteralPath $installed).Hash -ne $oldHash -or (Test-Path -LiteralPath $manifest)) { throw 'A corrupt update was not rejected safely.' }
Copy-Item -LiteralPath $NextExecutable -Destination $installed -Force
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$previousUrls = $env:ASPNETCORE_URLS
$previousUpdates = $env:Updates__Enabled
$previousBundle = $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR
$daemon = $null
try {
    $env:ASPNETCORE_URLS = "http://127.0.0.1:$port"
    $env:Updates__Enabled = 'false'
    $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR = Join-Path $root 'data/bundle'
    $daemon = Start-Process -FilePath $installed -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'daemon.log') -RedirectStandardError (Join-Path $root 'daemon-error.log')
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($daemon.HasExited) { throw 'The updated daemon exited during startup.' }
        try {
            $response = Invoke-RestMethod "http://127.0.0.1:$port/health/live" -TimeoutSec 1
            if ($response.status -eq 'healthy') { $healthy = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) { throw 'The updated daemon did not become healthy.' }
    $null = Invoke-RestMethod "http://127.0.0.1:$port/api/v1/setup/status" -TimeoutSec 5
    if (-not (Test-Path -LiteralPath (Join-Path $root 'plugin/Classight.Blog.dll')) -or
        -not (Test-Path -LiteralPath (Join-Path $root 'plugin/Classight.Chat.dll'))) { throw 'Built-in community plugins were not installed.' }
    Write-Output 'Updated Windows daemon startup and setup checks passed.'
}
finally {
    if ($null -ne $daemon) { if (-not $daemon.HasExited) { $daemon.Kill(); $daemon.WaitForExit() }; $daemon.Dispose() }
    $env:ASPNETCORE_URLS = $previousUrls
    $env:Updates__Enabled = $previousUpdates
    $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR = $previousBundle
}
