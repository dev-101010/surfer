@echo off
setlocal

:: Set the desired path where main.js is located
cd /d "%~dp0"

:: Check if Electron is installed
where electron >nul 2>nul
if %errorlevel% neq 0 (
    echo Electron not found, attempting to install...
    npm install -g electron
)

:: Start Electron with main.js
npx electron main.js

:: Pause for Windows
echo Press any key to exit...
pause >nul
