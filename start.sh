#!/usr/bin/env bash
#
# Surfer starten. Läuft danach unabhängig vom Terminal weiter.
#   ./start.sh          normaler Start
#   ./start.sh --debug  im Vordergrund mit Live-Protokoll (zur Fehlersuche)

export LANG="${LANG:-en_US.UTF-8}"
cd "$(dirname "$0")" || exit 1

DEBUG=0
[ "${1:-}" = "--debug" ] && DEBUG=1

pause_if_tty() {
    if [ -t 0 ]; then
        echo "Beliebige Taste zum Schließen ..."
        read -n 1 -s -r
    fi
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org/en/download"
    pause_if_tty
    exit 1
fi

if [ ! -d "node_modules/electron" ] || [ -f ".surfer-install-deps" ]; then
    echo "Installiere Abhängigkeiten. Das passiert nur beim ersten Start oder nach Updates ..."
    if ! npm install --no-fund --no-audit; then
        echo "npm install ist fehlgeschlagen. Bitte Internetverbindung und Schreibrechte prüfen."
        pause_if_tty
        exit 1
    fi
    rm -f ".surfer-install-deps"
fi

ELECTRON="$(node -e "process.stdout.write(require('electron'))" 2>/dev/null)"
if [ -z "$ELECTRON" ] || [ ! -x "$ELECTRON" ]; then
    echo "Electron ist nicht vollständig installiert. Bitte den Ordner node_modules löschen und erneut starten."
    pause_if_tty
    exit 1
fi

if [ "$DEBUG" = 1 ]; then
    echo "Surfer läuft im Debug-Modus. Das Protokoll erscheint hier."
    exec "$ELECTRON" .
fi

# Ausgabe in eine Datei, damit Fehler vor dem Programmstart (z. B. Chromium-Sandbox) auffindbar sind.
mkdir -p logs
nohup "$ELECTRON" . >logs/start.log 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

# Kurz prüfen, ob Electron wirklich läuft.
sleep 3
if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID" 2>/dev/null
    CODE=$?
    # Exit-Code 0 = es lief bereits eine Instanz, die jetzt ihr Fenster zeigt.
    if [ "$CODE" -ne 0 ]; then
        echo "Surfer konnte nicht gestartet werden (Code $CODE). Ausgabe aus logs/start.log:"
        echo
        tail -n 20 logs/start.log
        if grep -qi "sandbox" logs/start.log; then
            echo
            echo "Hinweis: Die Chromium-Sandbox ist auf diesem System blockiert (z. B. Ubuntu 24.04)."
            echo "Lösung: sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox"
        fi
        pause_if_tty
        exit 1
    fi
fi

echo "Surfer wurde gestartet."
