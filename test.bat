@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo Prüfe Schreibrechte im aktuellen Verzeichnis...
echo Test > write_test.tmp 2>nul
if errorlevel 1 (
    echo Fehler: Keine Schreibrechte im Verzeichnis "%CD%"!
    echo Bitte überprüfe die Berechtigungen oder starte als Administrator.
    pause
    exit /b
)
del write_test.tmp

echo Schreibrechte sind in Ordnung.

echo.
echo Prüfe Projektverzeichnis...
if not exist "package.json" (
    echo Fehler: Datei package.json fehlt! Das ist kein gültiges NodeJS-Projekt.
    pause
    exit /b
)

if not exist "node_modules" (
    echo Der Ordner "node_modules" fehlt! Starte "npm install"...
    call npm install || (
        echo Fehler: npm install ist fehlgeschlagen!
        pause
        exit /b
    )
)

echo "node_modules" ist vorhanden.

echo.
echo Installierte NodeJS-Pakete:
call npm list --depth=0

echo.
echo Prüfe, ob Electron installiert ist...
if exist "node_modules\electron" (
    echo Electron ist installiert.
) else (
    echo Electron fehlt! Installiere es jetzt...
    call npm install electron || (
        echo Fehler: Installation von Electron fehlgeschlagen!
        pause
        exit /b
    )
)

echo.
echo Starte Test für Electron...
call npx electron -v || (
    echo Fehler: Electron konnte nicht gestartet werden!
    pause
    exit /b
)

echo.
echo Alles erfolgreich geprüft! Dein Setup scheint in Ordnung zu sein.
pause
exit /b
