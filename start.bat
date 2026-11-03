@echo off
chcp 65001 >nul
setlocal

rem Surfer starten. Die Konsole ist nur sichtbar, solange Abhängigkeiten installiert werden.
rem Mit "start.bat --debug" (oder start-debug.bat) bleibt sie offen und zeigt das Protokoll.

cd /d "%~dp0"

set "DEBUG=0"
if /i "%~1"=="--debug" set "DEBUG=1"

where node >nul 2>nul || goto :nonode
where npm >nul 2>nul || goto :nonode

set "NEED_INSTALL=0"
if not exist "node_modules\electron" set "NEED_INSTALL=1"
if exist ".surfer-install-deps" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="1" call :install || goto :installfailed

set "ELECTRON="
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(require('electron'))" 2^>nul`) do set "ELECTRON=%%i"
if not defined ELECTRON goto :broken
if not exist "%ELECTRON%" goto :broken

if "%DEBUG%"=="1" goto :debug

rem Electron ist eine GUI-Anwendung: eigenständig starten, dieses Fenster schließt sich.
start "" /D "%~dp0" "%ELECTRON%" .
exit /b 0

:debug
echo Surfer läuft im Debug-Modus. Das Protokoll erscheint in diesem Fenster.
echo.
"%ELECTRON%" .
echo.
echo Surfer wurde beendet. Beliebige Taste zum Schließen ...
pause >nul
exit /b 0

:install
echo Installiere Abhängigkeiten. Das passiert nur beim ersten Start oder nach Updates ...
echo.
call npm install --no-fund --no-audit
if errorlevel 1 exit /b 1
if exist ".surfer-install-deps" del ".surfer-install-deps"
exit /b 0

:nonode
echo Node.js wurde nicht gefunden.
echo Bitte installieren: https://nodejs.org/en/download
pause
exit /b 1

:installfailed
echo.
echo npm install ist fehlgeschlagen. Bitte Internetverbindung und Schreibrechte prüfen.
pause
exit /b 1

:broken
echo Electron ist nicht vollständig installiert.
echo Bitte den Ordner node_modules löschen und Surfer erneut starten.
pause
exit /b 1
