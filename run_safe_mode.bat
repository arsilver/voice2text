@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  echo Dependencies are missing. Run npm install first.
  echo.
  pause
  exit /b 1
)

set "CRAFTVOICE_SAFE_MODE=1"
set "CRAFTVOICE_MINIMAL_STARTUP=1"
set "CRAFTVOICE_DISABLE_GPU=1"
set "CRAFTVOICE_DISABLE_TRAY=1"
set "CRAFTVOICE_DISABLE_HOTKEYS=1"
set "CRAFTVOICE_VERBOSE_LOGGING=1"

echo Building CraftVoice in safe mode...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Launching CraftVoice in safe mode...
call npm run start
set EXIT_CODE=%ERRORLEVEL%
if errorlevel 1 goto :fail

exit /b %EXIT_CODE%

:fail
echo.
echo CraftVoice safe mode failed to build or launch. Exit code %ERRORLEVEL%.
pause
exit /b %ERRORLEVEL%
