@echo off
setlocal

REM One-click launcher for Konkur Progress Lab.
REM Double-click this file. It builds the app if needed, starts a local server,
REM and opens your browser. Close the window (or press Ctrl+C) to stop.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required but was not found.
  echo   Install it from https://nodejs.org/ then run this file again.
  echo.
  pause
  exit /b 1
)

node scripts\serve.mjs

if errorlevel 1 (
  echo.
  echo   The app could not start. Try running: npm install
  echo.
  pause
)
