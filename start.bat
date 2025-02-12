@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install || exit /b
)

echo Starting Electron...
call npx electron main.js

echo.
echo Electron has been closed. Press any key to exit...
pause >nul