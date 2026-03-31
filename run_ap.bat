@echo off
setlocal

cd /d "%~dp0"

echo CraftVoice launcher uses the current workspace on branch master.
echo It rebuilds dist\ and launches via npm run start, not release\win-unpacked.
echo.

if not exist node_modules (
  echo Dependencies are missing. Run npm install first.
  echo.
  pause
  exit /b 1
)

set "CRAFTVOICE_MINIMAL_STARTUP=1"

if exist dist (
  echo Removing previous dist build...
  rmdir /s /q dist
  if errorlevel 1 goto :fail
)

echo Building CraftVoice...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Launching CraftVoice...
call npm run start
set EXIT_CODE=%ERRORLEVEL%
if errorlevel 1 goto :fail

exit /b %EXIT_CODE%

:fail
echo.
echo CraftVoice failed to build or launch. Exit code %ERRORLEVEL%.
pause
exit /b %ERRORLEVEL%
