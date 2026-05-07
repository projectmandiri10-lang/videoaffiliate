@echo off
setlocal

cd /d "%~dp0"
set "NEED_REPAIR=0"
set "DEV_URL=http://localhost:5173"

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    exit /b 1
  )
)

if not exist "node_modules\@babel\core\lib\index.js" (
  set "NEED_REPAIR=1"
)
if not exist "node_modules\@google\genai\dist\node\index.mjs" (
  set "NEED_REPAIR=1"
)

if "%NEED_REPAIR%"=="1" (
  echo [WARN] Detected incomplete dependencies. Running repair install...
  call npm install --force
  if errorlevel 1 (
    echo [ERROR] Dependency repair failed.
    exit /b 1
  )
)

echo [INFO] Starting server + frontend (dev mode)...
echo [INFO] Opening Chrome at %DEV_URL% shortly...
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; $url = '%DEV_URL%'; $paths = @(($env:ProgramFiles + '\Google\Chrome\Application\chrome.exe'), (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'), ($env:LocalAppData + '\Google\Chrome\Application\chrome.exe')); $chrome = $paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1; if ($chrome) { Start-Process -FilePath $chrome -ArgumentList $url } else { try { Start-Process -FilePath 'chrome.exe' -ArgumentList $url } catch { Start-Process -FilePath $url } }"
call npm run dev
