@echo off
cd /d "%~dp0"

if not exist "companion\server.js" (
  echo Chronicler is not unpacked.
  echo.
  echo It looks like start.cmd was opened from inside the ZIP file. Windows only
  echo unpacks the one file you double-click, so the app is missing.
  echo.
  echo Right-click the ZIP, choose Extract All, pick a folder such as C:\Chronicler,
  echo then run start.cmd from that folder.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node companion\server.js --open
pause
