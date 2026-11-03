@echo off
chcp 65001 >nul
setlocal

rem Starts Surfer. The console is only visible while dependencies are being installed.
rem "start.bat --debug" (or start-debug.bat) keeps it open and shows the log.

cd /d "%~dp0"

set "DEBUG=0"
if /i "%~1"=="--debug" set "DEBUG=1"

rem ---- language: German if the Windows locale is German, English otherwise ----
set "SYSLOCALE=xx"
for /f "tokens=3" %%l in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul') do set "SYSLOCALE=%%l"
if /i "%SYSLOCALE:~0,2%"=="de" goto :lang_de

set "M_NONODE1=Node.js was not found."
set "M_NONODE2=Please install it: https://nodejs.org/en/download"
set "M_INSTALL=Installing dependencies. This only happens on the first start or after updates ..."
set "M_INSTALLFAIL=npm install failed. Please check your internet connection and write permissions."
set "M_BROKEN1=Electron is not installed completely."
set "M_BROKEN2=Please delete the node_modules folder and start Surfer again."
set "M_DEBUG=Surfer is running in debug mode. The log appears in this window."
set "M_ENDED=Surfer has exited. Press any key to close ..."
goto :lang_done

:lang_de
set "M_NONODE1=Node.js wurde nicht gefunden."
set "M_NONODE2=Bitte installieren: https://nodejs.org/en/download"
set "M_INSTALL=Installiere Abhängigkeiten. Das passiert nur beim ersten Start oder nach Updates ..."
set "M_INSTALLFAIL=npm install ist fehlgeschlagen. Bitte Internetverbindung und Schreibrechte prüfen."
set "M_BROKEN1=Electron ist nicht vollständig installiert."
set "M_BROKEN2=Bitte den Ordner node_modules löschen und Surfer erneut starten."
set "M_DEBUG=Surfer läuft im Debug-Modus. Das Protokoll erscheint in diesem Fenster."
set "M_ENDED=Surfer wurde beendet. Beliebige Taste zum Schließen ..."

:lang_done

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

rem Electron is a GUI application: start it detached, this window closes.
start "" /D "%~dp0" "%ELECTRON%" .
exit /b 0

:debug
echo %M_DEBUG%
echo.
"%ELECTRON%" .
echo.
echo %M_ENDED%
pause >nul
exit /b 0

:install
echo %M_INSTALL%
echo.
call npm install --no-fund --no-audit
if errorlevel 1 exit /b 1
if exist ".surfer-install-deps" del ".surfer-install-deps"
exit /b 0

:nonode
echo %M_NONODE1%
echo %M_NONODE2%
pause
exit /b 1

:installfailed
echo.
echo %M_INSTALLFAIL%
pause
exit /b 1

:broken
echo %M_BROKEN1%
echo %M_BROKEN2%
pause
exit /b 1
