@echo off
REM ===================================================================
REM  OrangeJUCE dev launcher -- double-click this file, or run `dev.bat`
REM  from a terminal in this folder.
REM
REM  NOTE on `call`: npm on Windows is npm.cmd. Invoking it from a batch
REM  file WITHOUT `call` hands control away and never returns, so any
REM  error message flashes past and the window shuts before you can read
REM  it. Every npm invocation here uses `call` for that reason.
REM ===================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo  === OrangeJUCE dev server ===
echo.

REM --- 1. Free port 3000 if something stale is still listening ---
set "STALE="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo  [port] killing stale process %%p still holding port 3000
  taskkill /F /PID %%p >nul 2>&1
  set "STALE=1"
)
if defined STALE ping -n 3 127.0.0.1 >nul

REM --- 2. Dependencies ---
if not exist "node_modules\" (
  echo  [deps] installing dependencies, one time, takes a minute...
  call npm install
  if errorlevel 1 goto :failed
)

REM --- 2b. Local model (orangey) -- best-effort, never blocks the server ---
REM The app's default local model isn't in this repo (local-model/ is
REM gitignored on purpose -- see CLAUDE.md), so a fresh clone needs it
REM pulled down separately. Failure here is non-fatal: the app falls back
REM to whatever else Ollama/LM Studio has via autoDetectProvider.
where ollama >nul 2>&1
if not errorlevel 1 (
  call node scripts\setup-orangey-model.mjs
)

REM --- 3. Open the browser once the server actually answers ---
start "orangejuce-open" /min powershell -NoProfile -Command "$u='http://localhost:3000'; for($i=0;$i -lt 60;$i++){ try{ if((Invoke-WebRequest -Uri ($u+'/api/health') -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){ Start-Process $u; exit } }catch{}; Start-Sleep -Milliseconds 500 }"

echo  [run] starting server...
echo  [run] this one boots Express with Vite in middleware mode, so it takes
echo        several seconds and prints little -- that is normal.
echo  [run] the browser opens by itself when it is ready.
echo  [run] leave this window OPEN; closing it stops the server. Ctrl+C quits.
echo.

call npm run dev
if errorlevel 1 goto :failed

echo.
echo  === server stopped ===
pause
exit /b 0

:failed
echo.
echo  ============================================================
echo   FAILED -- the error is printed above this line.
echo   Copy that text; it says exactly what went wrong.
echo  ============================================================
pause
exit /b 1
