@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
set "ASPNETCORE_ENVIRONMENT=Production"
set "DOTNET_ENVIRONMENT=Production"
set "DOTNET_BUNDLE_EXTRACT_BASE_DIR=%~dp0data\bundle"
if exist "%~dp0data\updates\pending.json" (
    copy /y "%~dp0ClassightDaemon.exe" "%~dp0data\updates\ClassightDaemon.launcher.exe" >nul
    if not errorlevel 1 "%~dp0data\updates\ClassightDaemon.launcher.exe" --apply-update "%~dp0." "ClassightDaemon.exe" 0 0
)
"%~dp0ClassightDaemon.exe"
set "daemonExit=%ERRORLEVEL%"
popd
exit /b %daemonExit%
