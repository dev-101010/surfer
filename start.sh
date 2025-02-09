#!/bin/sh

# Setze den gewünschten Pfad, wo main.js liegt
PROJECT_PATH="$(dirname "$0")"

# Wechsle in das richtige Verzeichnis
cd "$PROJECT_PATH" || { echo "Fehler: Verzeichnis nicht gefunden!"; exit 1; }

# Prüfe, ob Electron installiert ist
if ! command -v electron &> /dev/null; then
    echo "Electron nicht gefunden, versuche zu installieren..."
    npm install -g electron
fi

# Starte Electron mit der main.js
npx electron main.js

# Pause für Linux/macOS
read -p "Drücke Enter zum Beenden..."