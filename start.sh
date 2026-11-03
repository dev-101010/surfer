#!/usr/bin/env bash
#
# Starts Surfer. It keeps running independently of the terminal.
#   ./start.sh          normal start
#   ./start.sh --debug  foreground with live log (for troubleshooting)

# ---- language: German if the system locale is German, English otherwise ----
SYS_LOCALE="${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"
if [ -z "$SYS_LOCALE" ] && command -v defaults >/dev/null 2>&1; then
    SYS_LOCALE="$(defaults read -g AppleLocale 2>/dev/null)"
fi
case "$SYS_LOCALE" in
    de*) DE=1 ;;
    *) DE=0 ;;
esac
msg() { if [ "$DE" = 1 ]; then echo "$1"; else echo "$2"; fi; }

export LANG="${LANG:-en_US.UTF-8}"
cd "$(dirname "$0")" || exit 1

DEBUG=0
[ "${1:-}" = "--debug" ] && DEBUG=1

pause_if_tty() {
    if [ -t 0 ]; then
        msg "Beliebige Taste zum Schließen ..." "Press any key to close ..."
        read -n 1 -s -r
    fi
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    msg "Node.js wurde nicht gefunden. Bitte installieren: https://nodejs.org/en/download" \
        "Node.js was not found. Please install it: https://nodejs.org/en/download"
    pause_if_tty
    exit 1
fi

if [ ! -d "node_modules/electron" ] || [ -f ".surfer-install-deps" ]; then
    msg "Installiere Abhängigkeiten. Das passiert nur beim ersten Start oder nach Updates ..." \
        "Installing dependencies. This only happens on the first start or after updates ..."
    if ! npm install --no-fund --no-audit; then
        msg "npm install ist fehlgeschlagen. Bitte Internetverbindung und Schreibrechte prüfen." \
            "npm install failed. Please check your internet connection and write permissions."
        pause_if_tty
        exit 1
    fi
    rm -f ".surfer-install-deps"
fi

ELECTRON="$(node -e "process.stdout.write(require('electron'))" 2>/dev/null)"
if [ -z "$ELECTRON" ] || [ ! -x "$ELECTRON" ]; then
    msg "Electron ist nicht vollständig installiert. Bitte den Ordner node_modules löschen und erneut starten." \
        "Electron is not installed completely. Please delete the node_modules folder and start again."
    pause_if_tty
    exit 1
fi

if [ "$DEBUG" = 1 ]; then
    msg "Surfer läuft im Debug-Modus. Das Protokoll erscheint hier." "Surfer is running in debug mode. The log appears here."
    exec "$ELECTRON" .
fi

# Output goes to a file so errors before the app starts (e.g. Chromium sandbox) can be found.
mkdir -p logs
nohup "$ELECTRON" . >logs/start.log 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

# Check briefly that Electron is really running.
sleep 3
if ! kill -0 "$PID" 2>/dev/null; then
    wait "$PID" 2>/dev/null
    CODE=$?
    # Exit code 0 = another instance was already running and now shows its window.
    if [ "$CODE" -ne 0 ]; then
        msg "Surfer konnte nicht gestartet werden (Code $CODE). Ausgabe aus logs/start.log:" \
            "Surfer could not be started (code $CODE). Output from logs/start.log:"
        echo
        tail -n 20 logs/start.log
        if grep -qi "sandbox" logs/start.log; then
            echo
            msg "Hinweis: Die Chromium-Sandbox ist auf diesem System blockiert (z. B. Ubuntu 24.04). Lösung:" \
                "Note: the Chromium sandbox is blocked on this system (e.g. Ubuntu 24.04). Fix:"
            echo "sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox"
        fi
        pause_if_tty
        exit 1
    fi
fi

msg "Surfer wurde gestartet." "Surfer has been started."
