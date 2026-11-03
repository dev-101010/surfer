'use strict';

/**
 * Central settings schema. Every value that can be changed in the UI is described here.
 * The schema drives validation (main process) and form generation (control window).
 *
 * type: 'bool' | 'int' | 'string'
 * restart: true => change only takes effect after an application restart
 */

const SETTINGS_GROUPS = [
    {
        id: 'windows',
        label: 'Surfer-Fenster',
        items: [
            {key: 'WINDOW_WIDTH', type: 'int', default: 1280, min: 320, max: 7680, unit: 'px', label: 'Fensterbreite', description: 'Breite neuer Surfer-Fenster.'},
            {key: 'WINDOW_HEIGHT', type: 'int', default: 720, min: 240, max: 4320, unit: 'px', label: 'Fensterhöhe', description: 'Höhe neuer Surfer-Fenster.'},
            {key: 'REMEMBER_BOUNDS', type: 'bool', default: true, label: 'Position merken', description: 'Größe und Position jedes Surfer-Fensters speichern und beim nächsten Start wiederherstellen.'},
            {key: 'SHOW_TOOLBAR', type: 'bool', default: true, label: 'Werkzeugleiste anzeigen', description: 'Leiste mit Status, Adresse und Schaltflächen oberhalb der Seite.'},
            {key: 'SHOW_IN_TASKBAR', type: 'bool', default: true, label: 'In Taskleiste anzeigen', description: 'Surfer-Fenster erscheinen als eigene Einträge in der Taskleiste.'},
            {key: 'START_HIDDEN', type: 'bool', default: false, label: 'Verborgen starten', description: 'Surfer laufen im Hintergrund, ohne dass ihr Fenster angezeigt wird.'}
        ]
    },
    {
        id: 'behaviour',
        label: 'Verhalten',
        items: [
            {key: 'AUTOSTART', type: 'bool', default: true, label: 'Autostart', description: 'Beim Programmstart alle Surfer mit aktiviertem Autostart starten.'},
            {key: 'MUTE_AUDIO', type: 'bool', default: true, label: 'Ton stummschalten', description: 'Alle Surfer und Popups standardmäßig stummschalten.'},
            {key: 'BLOCK_DIALOGS', type: 'bool', default: true, label: 'JS-Dialoge unterdrücken', description: 'alert/confirm/prompt blockieren, damit unbeaufsichtigte Surfer nie hängen bleiben. Gilt ab dem nächsten Start eines Surfers.'},
            {key: 'BACKGROUND_THROTTLING', type: 'bool', default: false, label: 'Hintergrund-Drosselung', description: 'Chromium drosselt Timer verborgener Fenster. Für Surfbars meist deaktiviert lassen.'},
            {key: 'CUSTOM_USER_AGENT', type: 'bool', default: false, label: 'Eigener User-Agent', description: 'Den unter „Filter & Identität“ hinterlegten User-Agent verwenden.'},
            {key: 'RELOAD_TIMER', type: 'int', default: 0, min: 0, max: 86400, unit: 's', label: 'Reload-Intervall', description: 'Seite alle X Sekunden neu laden (0 = aus).'},
            {key: 'STALL_TIMEOUT', type: 'int', default: 0, min: 0, max: 86400, unit: 's', label: 'Stillstand-Erkennung', description: 'Neu laden, wenn sich X Sekunden lang weder Adresse noch Titel noch ein Frame ändern (0 = aus).'},
            {key: 'CRASH_RESTART', type: 'bool', default: true, label: 'Automatisch wiederherstellen', description: 'Nach Absturz, Ladefehler oder Hänger automatisch neu laden (mit wachsender Wartezeit).'},
            {key: 'CRASH_RESTART_DELAY', type: 'int', default: 10, min: 1, max: 3600, unit: 's', label: 'Wartezeit Wiederherstellung', description: 'Basis-Wartezeit vor dem Neuladen. Verdoppelt sich bei wiederholten Fehlern (max. 32×).'},
            {key: 'UNRESPONSIVE_TIMEOUT', type: 'int', default: 30, min: 5, max: 600, unit: 's', label: 'Hänger-Timeout', description: 'Reagiert eine Seite so lange nicht, wird ihr Prozess beendet und neu geladen.'}
        ]
    },
    {
        id: 'scripts',
        label: 'Seiten-Skripte',
        items: [
            {key: 'JS_FAKE_VISIBLE_ENABLED', type: 'bool', default: true, label: 'Sichtbarkeit vortäuschen', description: 'Seite hält sich immer für sichtbar und fokussiert (auch in iFrames).'},
            {key: 'JS_MOUSE_SIMULATION', type: 'bool', default: true, label: 'Mausbewegung simulieren', description: 'Alle 5–15 Sekunden eine Mausbewegung auslösen.'},
            {key: 'JS_CHECK_ENABLED', type: 'bool', default: true, label: 'DOM-Wächter', description: 'Video-/Audio-Elemente und srcdoc-iFrames sofort entfernen.'}
        ]
    },
    {
        id: 'filter',
        label: 'Filter',
        items: [
            {key: 'ALLOW_WHITELIST', type: 'bool', default: true, label: 'Whitelist', description: 'Anfragen an Whitelist-Domains immer erlauben (überspringt die folgenden Filter).'},
            {key: 'BLOCK_DOMAINS', type: 'bool', default: true, label: 'Domains sperren', description: 'Anfragen an gesperrte Domains blockieren.'},
            {key: 'BLOCK_EXTENSIONS', type: 'bool', default: true, label: 'Dateiendungen sperren', description: 'Anfragen auf gesperrte Dateiendungen blockieren.'},
            {key: 'BLOCK_MEDIA', type: 'bool', default: true, label: 'Medien sperren', description: 'Audio, Video und Streams blockieren (Anfragetyp und Content-Type).'},
            {key: 'BLOCK_DOWNLOADS', type: 'bool', default: true, label: 'Downloads sperren', description: 'Alle Downloads verhindern.'},
            {key: 'BLOCK_OTHER_URL_TYPES', type: 'bool', default: true, label: 'Sonstige Verbindungen sperren', description: 'WebSockets, blob:/data:-Frames und -Medien blockieren, WebRTC-Leaks unterbinden.'},
            {key: 'MAX_IFRAME_DEPTH', type: 'int', default: 3, min: 0, max: 20, label: 'Max. iFrame-Tiefe', description: 'Tiefer verschachtelte iFrames blockieren (0 = unbegrenzt).'},
            {key: 'BLOCK_NAVIGATION_TO_OTHER_DOMAINS', type: 'bool', default: true, label: 'Fremdnavigation sperren', description: 'Die Hauptseite darf nur innerhalb ihrer Domain (oder zur Whitelist) navigieren.'},
            {key: 'BLOCK_NOT_WHITELISTED_POPUPS', type: 'bool', default: true, label: 'Popups filtern', description: 'Nur Popups von oder zu Whitelist-Domains zulassen.'},
            {key: 'MAX_POPUPS', type: 'int', default: 3, min: 0, max: 20, label: 'Max. Popups je Surfer', description: 'Höchstzahl gleichzeitig offener Popups pro Surfer (0 = keine Popups).'},
            {key: 'LOG_BLOCKED', type: 'bool', default: true, label: 'Blockierungen protokollieren', description: 'Jede blockierte Anfrage im Protokoll aufführen (gezählt wird immer).'}
        ]
    },
    {
        id: 'monitor',
        label: 'Überwachung',
        items: [
            {key: 'RENDERER_OVERLOAD_CHECK', type: 'bool', default: false, label: 'Renderer-Überlast', description: 'Surfer neu laden, wenn sein Prozess dauerhaft zu viel CPU verbraucht.'},
            {key: 'RENDERER_CPU_THRESHOLD', type: 'int', default: 90, min: 10, max: 1000, unit: '%', label: 'Renderer-CPU-Grenze', description: 'CPU-Last eines Renderer-Prozesses (100 % = ein Kern).'},
            {key: 'RENDERER_EXCEED_LIMIT', type: 'int', default: 3, min: 1, max: 100, label: 'Renderer-Überschreitungen', description: 'Anzahl aufeinanderfolgender Messungen (alle 2 s) über der Grenze bis zum Neuladen.'},
            {key: 'OVERLOAD_ENABLED', type: 'bool', default: false, label: 'System-Überlast', description: 'Alle Surfer neu laden, wenn System-CPU oder -RAM dauerhaft über der Grenze liegen.'},
            {key: 'OVERLOAD_WARNING_CPU', type: 'int', default: 50, min: 1, max: 100, unit: '%', label: 'Warnung CPU', description: 'Ab dieser System-CPU-Last wird gewarnt.'},
            {key: 'OVERLOAD_WARNING_RAM', type: 'int', default: 50, min: 1, max: 100, unit: '%', label: 'Warnung RAM', description: 'Ab dieser RAM-Auslastung wird gewarnt.'},
            {key: 'OVERLOAD_THRESHOLD_CPU', type: 'int', default: 90, min: 1, max: 100, unit: '%', label: 'Grenze CPU', description: 'Ab dieser System-CPU-Last zählt eine Überschreitung.'},
            {key: 'OVERLOAD_THRESHOLD_RAM', type: 'int', default: 90, min: 1, max: 100, unit: '%', label: 'Grenze RAM', description: 'Ab dieser RAM-Auslastung zählt eine Überschreitung.'},
            {key: 'OVERLOAD_CHECK_INTERVAL', type: 'int', default: 5, min: 1, max: 3600, unit: 's', label: 'Prüfintervall', description: 'Abstand der System-Messungen.'},
            {key: 'OVERLOAD_EXCEED_LIMIT', type: 'int', default: 3, min: 1, max: 100, label: 'System-Überschreitungen', description: 'Anzahl aufeinanderfolgender Überschreitungen bis zum Neuladen aller Surfer.'}
        ]
    },
    {
        id: 'logging',
        label: 'Protokoll',
        items: [
            {key: 'LOG_TO_FILE', type: 'bool', default: false, label: 'In Datei schreiben', description: 'Protokoll zusätzlich nach logs/surfer.log schreiben (rotiert bei 5 MB).'},
            {key: 'LOG_TO_CONSOLE', type: 'bool', default: true, label: 'In Konsole schreiben', description: 'Protokoll zusätzlich farbig in der Konsole ausgeben.'}
        ]
    },
    {
        id: 'updates',
        label: 'Updates',
        items: [
            {key: 'UPDATE_CHECK', type: 'bool', default: true, label: 'Automatisch nach Updates suchen', description: 'Beim Start und danach alle 24 Stunden auf GitHub nach einer neuen Version suchen. Installiert wird nur auf Knopfdruck.'}
        ]
    }
];

const BROWSER_GROUPS = [
    {
        id: 'browser',
        label: 'Browser-Engine',
        restart: true,
        items: [
            {key: 'disableSiteIsolationTrials', type: 'bool', default: true, label: 'Site-Isolation aus', description: 'Weniger Prozesse, weniger RAM. Etwas geringere Isolation zwischen Seiten.'},
            {key: 'disableGpuProcessPrelaunch', type: 'bool', default: true, label: 'GPU-Prozess nicht vorladen', description: ''},
            {key: 'disableRendererBackgrounding', type: 'bool', default: true, label: 'Renderer nicht in den Hintergrund', description: 'Verhindert Prioritätsabsenkung verborgener Fenster.'},
            {key: 'enableLowEndDeviceMode', type: 'bool', default: true, label: 'Low-End-Modus', description: 'Chromium spart Speicher auf Kosten der Leistung.'},
            {key: 'disableAccelerated2DCanvas', type: 'bool', default: true, label: '2D-Canvas-Beschleunigung aus', description: ''},
            {key: 'disableHardwareAcceleration', type: 'bool', default: true, label: 'Hardwarebeschleunigung aus', description: ''},
            {key: 'disableSoftwareRasterizer', type: 'bool', default: true, label: 'Software-Rasterizer aus', description: ''},
            {key: 'disableGpu', type: 'bool', default: true, label: 'GPU aus', description: ''},
            {key: 'disableGpuCompositing', type: 'bool', default: true, label: 'GPU-Compositing aus', description: ''},
            {key: 'rendererProcessLimit', type: 'int', default: 4, min: 0, max: 64, label: 'Renderer-Prozesslimit', description: 'Höchstzahl an Renderer-Prozessen (0 = Chromium entscheidet). Für viele Surfer erhöhen.'}
        ]
    }
];

const STRING_MAX = 1024;

function flatten(groups) {
    const out = [];
    for (const g of groups) for (const item of g.items) out.push({...item, restart: Boolean(g.restart || item.restart)});
    return out;
}

const SETTINGS_ITEMS = flatten(SETTINGS_GROUPS);
const BROWSER_ITEMS = flatten(BROWSER_GROUPS);

function defaultsFrom(items) {
    const out = {};
    for (const item of items) out[item.key] = item.default;
    return out;
}

/**
 * Coerces and validates a single value against its schema item.
 * Returns {ok: true, value} or {ok: false, error}.
 */
function sanitizeValue(item, raw) {
    switch (item.type) {
        case 'bool': {
            if (typeof raw === 'boolean') return {ok: true, value: raw};
            if (raw === 'true' || raw === 1 || raw === '1') return {ok: true, value: true};
            if (raw === 'false' || raw === 0 || raw === '0') return {ok: true, value: false};
            return {ok: false, error: `${item.label}: Ja/Nein erwartet`};
        }
        case 'int': {
            const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
            if (typeof n !== 'number' || !Number.isFinite(n)) return {ok: false, error: `${item.label}: Zahl erwartet`};
            const v = Math.round(n);
            if (item.min !== undefined && v < item.min) return {ok: false, error: `${item.label}: Mindestens ${item.min}`};
            if (item.max !== undefined && v > item.max) return {ok: false, error: `${item.label}: Höchstens ${item.max}`};
            return {ok: true, value: v};
        }
        case 'string': {
            if (typeof raw !== 'string') return {ok: false, error: `${item.label}: Text erwartet`};
            const max = item.maxLength || STRING_MAX;
            if (raw.length > max) return {ok: false, error: `${item.label}: Höchstens ${max} Zeichen`};
            return {ok: true, value: raw};
        }
        default:
            return {ok: false, error: `Unbekannter Typ für ${item.key}`};
    }
}

/**
 * Builds a complete, valid object from untrusted input.
 * Unknown keys are dropped, invalid values fall back to `base` (or schema default).
 * Returns {value, errors, changed}.
 */
function sanitizeObject(items, input, base) {
    const value = {};
    const errors = [];
    let changed = false;
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    for (const item of items) {
        const fallback = base && item.key in base ? base[item.key] : item.default;
        if (!(item.key in src)) {
            value[item.key] = fallback;
            changed = true;
            continue;
        }
        const res = sanitizeValue(item, src[item.key]);
        if (res.ok) {
            value[item.key] = res.value;
            if (res.value !== src[item.key]) changed = true;
        } else {
            value[item.key] = fallback;
            errors.push(res.error);
            changed = true;
        }
    }
    for (const key of Object.keys(src)) if (!items.some(i => i.key === key)) changed = true;
    return {value, errors, changed};
}

/**
 * Applies a partial patch to an existing (valid) object. Rejects the whole patch on any error
 * so the UI can show exactly what was wrong.
 */
function applyPatch(items, current, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return {ok: false, errors: ['Ungültige Änderung']};
    }
    const next = {...current};
    const errors = [];
    const changedKeys = [];
    for (const [key, raw] of Object.entries(patch)) {
        const item = items.find(i => i.key === key);
        if (!item) {
            errors.push(`Unbekannte Einstellung: ${String(key).slice(0, 64)}`);
            continue;
        }
        const res = sanitizeValue(item, raw);
        if (!res.ok) {
            errors.push(res.error);
            continue;
        }
        if (next[key] !== res.value) {
            next[key] = res.value;
            changedKeys.push(key);
        }
    }
    if (errors.length) return {ok: false, errors};
    return {ok: true, value: next, changedKeys};
}

module.exports = {
    SETTINGS_GROUPS,
    BROWSER_GROUPS,
    SETTINGS_ITEMS,
    BROWSER_ITEMS,
    DEFAULT_SETTINGS: defaultsFrom(SETTINGS_ITEMS),
    DEFAULT_BROWSER: defaultsFrom(BROWSER_ITEMS),
    sanitizeValue,
    sanitizeObject,
    applyPatch
};
