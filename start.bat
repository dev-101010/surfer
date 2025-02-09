@echo off
chcp 65001 >nul

SET PROJECT_PATH=%~dp0

REM Wechsel in das richtige Verzeichnis
cd /d "%PROJECT_PATH%"

REM Prüfe, ob Electron installiert ist
where electron >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo Electron nicht gefunden, versuche zu installieren...
    npm install -g electron
)

REM Starte Electron mit main.js
npx electron main.js

REM Pause für Windows
pause
