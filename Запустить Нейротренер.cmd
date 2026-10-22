@echo off
chcp 65001 >nul
cd /d "%~dp0app"
where node >nul 2>nul
if %errorlevel%==0 (
  node server.mjs
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.mjs
  ) else (
    echo Нужен Node.js версии 22 или новее. Установите его и запустите файл еще раз.
  )
)
pause
