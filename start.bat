@echo off
chcp 65001 >nul

SET PROJECT_PATH=%~dp0

REM Wechsel in das richtige Verzeichnis
cd /d "%PROJECT_PATH%"

REM Prüfe, ob Electron verfügbar ist (npx nutzt globale Installation)
where electron >nul 2>nul
IF ERRORLEVEL 1 (
    echo Electron nicht gefunden, versuche zu installieren...
    npm install -g electron || exit /b 1
)

REM Starte Electron mit main.js über npx (nutzt globale Installation, falls vorhanden)
npx electron main.js

REM Pause für Windows
pause
