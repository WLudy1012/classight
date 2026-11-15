param(
    [string]$InstallDirectory = $PSScriptRoot,
    [string]$ExecutableName = 'ClassightDaemon.exe',
    [int]$WaitForProcessId = 0,
    [long]$WaitForStartTicks = 0
)
$ErrorActionPreference = 'Stop'
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ([IO.Path]::GetFileName($ExecutableName) -ne $ExecutableName -or
    $ExecutableName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
    -not $ExecutableName.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Expected an executable filename without a directory.'
}
$updateDirectory = Join-Path $InstallDirectory 'data/updates'
$pendingFile = Join-Path $updateDirectory 'pending.json'
$pendingExecutable = Join-Path $updateDirectory 'ClassightDaemon.pending.exe'
$installedExecutable = Join-Path $InstallDirectory $ExecutableName
$backupExecutable = Join-Path $updateDirectory 'ClassightDaemon.previous.exe'

function Get-UpdateEnvironmentValue([string]$Prefix) {
    $value = [Environment]::GetEnvironmentVariable($Prefix + 'Updates__Enabled')
    if ($null -eq $value) {
        $value = [Environment]::GetEnvironmentVariable($Prefix + 'Updates:Enabled')
    }
    return $value
}

function Test-UpdateEnabled {
    $environmentValue = Get-UpdateEnvironmentValue ''
    if ($null -ne $environmentValue) { return [bool]::Parse($environmentValue) }
    $enabled = 'true'
    foreach ($prefix in @('ASPNETCORE_', 'DOTNET_')) {
        $value = Get-UpdateEnvironmentValue $prefix
        if ($null -ne $value) { $enabled = $value }
    }
    foreach ($name in @('appsettings.json', 'appsettings.Local.json')) {
        $path = Join-Path (Join-Path $InstallDirectory 'config') $name
        if (-not [IO.File]::Exists($path)) { $path = Join-Path $InstallDirectory $name }
        if (-not [IO.File]::Exists($path)) { continue }
        $json = [IO.File]::ReadAllText($path)
        $stringLiteral = '"(?:\\.|[^"\\])*"'
        $json = [regex]::Replace($json, '(?s)' + $stringLiteral + '|/\*.*?\*/|//[^\r\n]*', {
            param($token)
            if ($token.Value.StartsWith('/')) { return ' ' }
            return $token.Value
        })
        $json = [regex]::Replace($json, $stringLiteral + '|,(?=\s*[}\]])', {
            param($token)
            if ($token.Value -eq ',') { return '' }
            return $token.Value
        })
        $configuration = ConvertFrom-Json -InputObject $json
        $value = $configuration.'Updates:Enabled'
        if ($null -eq $value) { $value = $configuration.Updates.Enabled }
        if ($null -ne $value) { $enabled = [string]$value }
    }
    return [bool]::Parse($enabled)
}

function Get-StableVersion([string]$VersionText) {
    if ($VersionText -notmatch '\A((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z') {
        throw 'Expected a stable version in X.Y.Z format.'
    }
    return [version]$Matches[1]
}

function Get-ExecutableHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        }
        finally { $sha256.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Restore-PreviousExecutable {
    if (-not [IO.File]::Exists($installedExecutable) -and [IO.File]::Exists($backupExecutable)) {
        [IO.File]::Move($backupExecutable, $installedExecutable)
    }
}

if (-not [IO.File]::Exists($pendingFile)) { return }

if ($WaitForProcessId -gt 0) {
    $daemon = $null
    try { $daemon = [Diagnostics.Process]::GetProcessById($WaitForProcessId) }
    catch [ArgumentException] { }
    if ($null -ne $daemon) {
        try {
            if ($daemon.StartTime.ToUniversalTime().Ticks -eq $WaitForStartTicks) { $daemon.WaitForExit() }
        }
        finally { $daemon.Dispose() }
    }
}

$updateLock = $null
try {
    $updateLock = [IO.File]::Open((Join-Path $updateDirectory 'update.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    if (-not [IO.File]::Exists($pendingFile)) { return }
    Restore-PreviousExecutable
    if (-not (Test-UpdateEnabled) -or -not [IO.File]::Exists($installedExecutable)) { return }
    $installedVersion = Get-StableVersion ([Diagnostics.FileVersionInfo]::GetVersionInfo($installedExecutable).ProductVersion)

    try {
        if ((New-Object IO.FileInfo $pendingFile).Length -gt 4096) { throw 'The pending update manifest is too large.' }
        $pending = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($pendingFile))
        $targetName = if ($pending.executableName) { $pending.executableName } else { 'ClassightDaemon.exe' }
        if ($targetName -ne $ExecutableName) { throw 'The pending update targets another executable.' }
        $nextVersion = Get-StableVersion $pending.version
        $baseVersion = Get-StableVersion $pending.currentVersion
        if ($nextVersion -le $installedVersion -or $baseVersion -ne $installedVersion) {
            throw 'The pending update no longer matches this installation.'
        }
        if ($pending.sha256 -notmatch '\A[0-9a-fA-F]{64}\z' -or
            (Get-ExecutableHash $pendingExecutable) -ne $pending.sha256) {
            throw 'The pending update failed SHA-256 verification.'
        }
        if ((Get-StableVersion ([Diagnostics.FileVersionInfo]::GetVersionInfo($pendingExecutable).ProductVersion)) -ne $nextVersion) {
            throw 'The pending executable version does not match its release.'
        }
    }
    catch {
        [IO.File]::Delete($pendingFile)
        [IO.File]::Delete($pendingExecutable)
        Write-Warning "Classight discarded a pending update. $($_.Exception.Message)"
        return
    }

    try {
        [IO.File]::Replace($pendingExecutable, $installedExecutable, $backupExecutable)
    }
    catch {
        Restore-PreviousExecutable
        throw
    }
    [IO.File]::Delete($pendingFile)
    [IO.File]::Delete((Join-Path $updateDirectory 'last-error.txt'))
    Write-Host "Classight updated from $installedVersion to $nextVersion."
}
catch {
    try { [IO.File]::WriteAllText((Join-Path $updateDirectory 'last-error.txt'), $_.Exception.Message) } catch { }
    Write-Warning "Classight could not apply the pending update. $($_.Exception.Message)"
}
finally {
    if ($null -ne $updateLock) { $updateLock.Dispose() }
}
