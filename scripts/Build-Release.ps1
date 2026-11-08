#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Version,
    [string]$OutputDirectory,
    [string]$DotnetPath,
    [string]$FrontendArchive
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = "dist/releases/v$Version" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory, $projectRoot)
if (Test-Path -LiteralPath $OutputDirectory) { throw "Release output already exists: $OutputDirectory" }
if (-not $DotnetPath) {
    $localDotnet = Join-Path $projectRoot $(if ($IsWindows) { '.tools/dotnet/dotnet.exe' } else { '.tools/dotnet/dotnet' })
    $DotnetPath = if (Test-Path -LiteralPath $localDotnet) { $localDotnet } else { (Get-Command dotnet -ErrorAction Stop).Source }
}

$buildDirectory = Join-Path $projectRoot ('dist/release-build/' + [Guid]::NewGuid().ToString('N'))
$assetsDirectory = Join-Path $buildDirectory 'assets'
$windowsPackage = Join-Path $buildDirectory 'Classight-Windows-x64'
New-Item -ItemType Directory -Path $assetsDirectory, $windowsPackage | Out-Null
if (-not $FrontendArchive) {
    $webDirectory = Join-Path $projectRoot 'web'
    $previousApiMode = $env:VITE_API_MODE
    Push-Location -LiteralPath $webDirectory
    try {
        $env:VITE_API_MODE = 'http'
        & pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    }
    finally {
        $env:VITE_API_MODE = $previousApiMode
        Pop-Location
    }
    $FrontendArchive = Join-Path $buildDirectory 'frontend.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $webDirectory 'dist'), $FrontendArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
}
$FrontendArchive = [IO.Path]::GetFullPath($FrontendArchive, $projectRoot)
$frontend = [IO.Compression.ZipFile]::OpenRead($FrontendArchive)
try {
    if (-not $frontend.GetEntry('index.html')) { throw 'The frontend archive must contain index.html at its root.' }
}
finally { $frontend.Dispose() }

function Copy-WindowsRuntimeNotices {
    $assets = Get-Content -LiteralPath (Join-Path $projectRoot 'backend/src/Classight.Api/obj/project.assets.json') -Raw | ConvertFrom-Json -AsHashtable
    $frameworkPacks = @('Microsoft.NETCore.App.Runtime.win-x64', 'Microsoft.AspNetCore.App.Runtime.win-x64')
    foreach ($framework in $assets.project.frameworks.Values) {
        foreach ($pack in $framework.downloadDependencies | Where-Object name -in $frameworkPacks) {
            $packVersion = $pack.version.Trim('[', ']').Split(',')[0].Trim()
            $packName = $pack.name.ToLowerInvariant()
            foreach ($cache in $assets.packageFolders.Keys) {
                $runtimePath = Join-Path $cache "$packName/$packVersion"
                if (-not (Test-Path -LiteralPath $runtimePath)) { continue }
                $noticeDirectory = Join-Path $windowsPackage "licenses/$packName"
                New-Item -ItemType Directory -Path $noticeDirectory -Force | Out-Null
                Get-ChildItem -LiteralPath $runtimePath -File | Where-Object { $_.Name -like 'LICENSE*' -or $_.Name -like 'THIRD-PARTY-NOTICES*' } | Copy-Item -Destination $noticeDirectory
                break
            }
        }
    }
}

$targets = @(
    @{ Rid = 'win-x64'; SelfContained = 'true'; Output = 'Classight.Api.exe'; Asset = 'ClassightDaemon-win-x64.exe' },
    @{ Rid = 'linux-x64'; SelfContained = 'false'; Output = 'Classight.Api'; Asset = 'ClassightDaemon-linux-x64' }
)
Push-Location -LiteralPath $projectRoot
try {
    foreach ($target in $targets) {
        $publishDirectory = Join-Path $buildDirectory $target.Rid
        $publishArgs = @(
            'publish', 'backend/src/Classight.Api/Classight.Api.csproj', '-c', 'Release', '-r', $target.Rid,
            '--self-contained', $target.SelfContained, '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
            '-p:DebugType=None', '-p:DebugSymbols=false', '-p:ClassightStandalone=true',
            "-p:ClassightFrontendArchive=$FrontendArchive", "-p:Version=$Version", '-p:IncludeSourceRevisionInInformationalVersion=false',
            '-o', $publishDirectory, '--verbosity', 'quiet'
        )
        & $DotnetPath @publishArgs
        if ($LASTEXITCODE -ne 0) { throw "Publish failed for $($target.Rid)." }
        Copy-Item -LiteralPath (Join-Path $publishDirectory $target.Output) -Destination (Join-Path $assetsDirectory $target.Asset)
        if ($target.Rid -eq 'win-x64') { Copy-WindowsRuntimeNotices }
    }
}
finally { Pop-Location }

Copy-Item -LiteralPath (Join-Path $assetsDirectory 'ClassightDaemon-win-x64.exe') -Destination (Join-Path $windowsPackage 'ClassightDaemon.exe')
Copy-Item -LiteralPath @((Join-Path $PSScriptRoot 'Start-Classight.cmd'), (Join-Path $PSScriptRoot 'Apply-ClassightUpdate.ps1'), (Join-Path $projectRoot 'LICENSE')) -Destination $windowsPackage
[IO.Compression.ZipFile]::CreateFromDirectory($windowsPackage, (Join-Path $assetsDirectory 'Classight-Windows-x64.zip'), [IO.Compression.CompressionLevel]::Optimal, $true)

foreach ($asset in Get-ChildItem -LiteralPath $assetsDirectory -File) {
    $sha256 = (Get-FileHash -LiteralPath $asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($asset.FullName + '.sha256', "$sha256  $($asset.Name)`n", [Text.Encoding]::ASCII)
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
foreach ($asset in Get-ChildItem -LiteralPath $assetsDirectory -File) {
    Move-Item -LiteralPath $asset.FullName -Destination (Join-Path $OutputDirectory $asset.Name)
}
Write-Output "Release assets: $OutputDirectory"
