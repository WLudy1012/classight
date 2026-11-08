@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "ASPNETCORE_ENVIRONMENT=Production"
set "DOTNET_ENVIRONMENT=Production"
set "DOTNET_BUNDLE_EXTRACT_BASE_DIR=%~dp0data\bundle"
if exist "%~dp0data\updates\pending.json" (
    "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Apply-ClassightUpdate.ps1"
)
"%~dp0ClassightDaemon.exe"
set "daemonExit=%ERRORLEVEL%"
popd
exit /b %daemonExit%
