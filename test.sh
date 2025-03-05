#!/bin/bash

# Setzt den Fehler-Modus: Falls ein Befehl fehlschlägt, bricht das Skript ab
set -e

echo "Prüfe Schreibrechte im aktuellen Verzeichnis..."
if [ ! -w "." ]; then
    echo "Fehler: Keine Schreibrechte im Verzeichnis $(pwd)!"
    echo "Bitte überprüfe die Berechtigungen oder führe das Skript mit sudo aus."
    exit 1
fi
echo "Schreibrechte sind in Ordnung."

echo
echo "Prüfe Projektverzeichnis..."
if [ ! -f "package.json" ]; then
    echo "Fehler: Datei package.json fehlt! Das ist kein gültiges NodeJS-Projekt."
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Der Ordner 'node_modules' fehlt! Starte 'npm install'..."
    npm install || { echo "Fehler: npm install ist fehlgeschlagen!"; exit 1; }
fi
echo "'node_modules' ist vorhanden."

echo
echo "Installierte NodeJS-Pakete:"
npm list --depth=0

echo
echo "Prüfe, ob Electron installiert ist..."
if [ -d "node_modules/electron" ]; then
    echo "Electron ist installiert."
else
    echo "Electron fehlt! Installiere es jetzt..."
    npm install electron || { echo "Fehler: Installation von Electron fehlgeschlagen!"; exit 1; }
fi

echo
echo "Starte Test für Electron..."
npx electron -v || { echo "Fehler: Electron konnte nicht gestartet werden!"; exit 1; }

echo
echo "Alles erfolgreich geprüft! Dein Setup scheint in Ordnung zu sein."
exit 0
