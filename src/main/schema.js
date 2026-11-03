'use strict';

/**
 * Central settings schema. Every value that can be changed in the UI is described here.
 * The schema drives validation (main process) and form generation (control window).
 * Labels and descriptions live in i18n.js under s.<KEY>.label / s.<KEY>.desc, group names under g.<id>.
 *
 * type: 'bool' | 'int' | 'string' | 'enum'
 * restart: true => change only takes effect after an application restart
 */

const {t} = require('./i18n');

const SETTINGS_GROUPS = [
    {
        id: 'general',
        items: [
            {key: 'LANGUAGE', type: 'enum', default: 'auto', options: ['auto', 'de', 'en']}
        ]
    },
    {
        id: 'windows',
        items: [
            {key: 'WINDOW_WIDTH', type: 'int', default: 1280, min: 320, max: 7680, unit: 'px'},
            {key: 'WINDOW_HEIGHT', type: 'int', default: 720, min: 240, max: 4320, unit: 'px'},
            {key: 'REMEMBER_BOUNDS', type: 'bool', default: true},
            {key: 'SHOW_TOOLBAR', type: 'bool', default: true},
            {key: 'SHOW_IN_TASKBAR', type: 'bool', default: true},
            {key: 'START_HIDDEN', type: 'bool', default: false}
        ]
    },
    {
        id: 'behaviour',
        items: [
            {key: 'AUTOSTART', type: 'bool', default: true},
            {key: 'MUTE_AUDIO', type: 'bool', default: true},
            {key: 'BLOCK_DIALOGS', type: 'bool', default: true},
            {key: 'BACKGROUND_THROTTLING', type: 'bool', default: false},
            {key: 'CUSTOM_USER_AGENT', type: 'bool', default: false},
            {key: 'RELOAD_TIMER', type: 'int', default: 0, min: 0, max: 86400, unit: 's'},
            {key: 'STALL_TIMEOUT', type: 'int', default: 0, min: 0, max: 86400, unit: 's'},
            {key: 'CRASH_RESTART', type: 'bool', default: true},
            {key: 'CRASH_RESTART_DELAY', type: 'int', default: 10, min: 1, max: 3600, unit: 's'},
            {key: 'UNRESPONSIVE_TIMEOUT', type: 'int', default: 30, min: 5, max: 600, unit: 's'}
        ]
    },
    {
        id: 'scripts',
        items: [
            {key: 'JS_FAKE_VISIBLE_ENABLED', type: 'bool', default: true},
            {key: 'JS_MOUSE_SIMULATION', type: 'bool', default: true},
            {key: 'JS_CHECK_ENABLED', type: 'bool', default: true}
        ]
    },
    {
        id: 'filter',
        items: [
            {key: 'ALLOW_WHITELIST', type: 'bool', default: true},
            {key: 'BLOCK_DOMAINS', type: 'bool', default: true},
            {key: 'BLOCK_EXTENSIONS', type: 'bool', default: true},
            {key: 'BLOCK_MEDIA', type: 'bool', default: true},
            {key: 'BLOCK_DOWNLOADS', type: 'bool', default: true},
            {key: 'BLOCK_OTHER_URL_TYPES', type: 'bool', default: true},
            {key: 'MAX_IFRAME_DEPTH', type: 'int', default: 3, min: 0, max: 20},
            {key: 'BLOCK_NAVIGATION_TO_OTHER_DOMAINS', type: 'bool', default: true},
            {key: 'BLOCK_NOT_WHITELISTED_POPUPS', type: 'bool', default: true},
            {key: 'MAX_POPUPS', type: 'int', default: 3, min: 0, max: 20},
            {key: 'LOG_BLOCKED', type: 'bool', default: true}
        ]
    },
    {
        id: 'monitor',
        items: [
            {key: 'RENDERER_OVERLOAD_CHECK', type: 'bool', default: false},
            {key: 'RENDERER_CPU_THRESHOLD', type: 'int', default: 90, min: 10, max: 1000, unit: '%'},
            {key: 'RENDERER_EXCEED_LIMIT', type: 'int', default: 3, min: 1, max: 100},
            {key: 'OVERLOAD_ENABLED', type: 'bool', default: false},
            {key: 'OVERLOAD_WARNING_CPU', type: 'int', default: 50, min: 1, max: 100, unit: '%'},
            {key: 'OVERLOAD_WARNING_RAM', type: 'int', default: 50, min: 1, max: 100, unit: '%'},
            {key: 'OVERLOAD_THRESHOLD_CPU', type: 'int', default: 90, min: 1, max: 100, unit: '%'},
            {key: 'OVERLOAD_THRESHOLD_RAM', type: 'int', default: 90, min: 1, max: 100, unit: '%'},
            {key: 'OVERLOAD_CHECK_INTERVAL', type: 'int', default: 5, min: 1, max: 3600, unit: 's'},
            {key: 'OVERLOAD_EXCEED_LIMIT', type: 'int', default: 3, min: 1, max: 100}
        ]
    },
    {
        id: 'logging',
        items: [
            {key: 'LOG_TO_FILE', type: 'bool', default: false},
            {key: 'LOG_TO_CONSOLE', type: 'bool', default: true}
        ]
    },
    {
        id: 'updates',
        items: [
            {key: 'UPDATE_CHECK', type: 'bool', default: true}
        ]
    }
];

const BROWSER_GROUPS = [
    {
        id: 'browser',
        restart: true,
        items: [
            {key: 'disableSiteIsolationTrials', type: 'bool', default: true},
            {key: 'disableGpuProcessPrelaunch', type: 'bool', default: true},
            {key: 'disableRendererBackgrounding', type: 'bool', default: true},
            {key: 'enableLowEndDeviceMode', type: 'bool', default: true},
            {key: 'disableAccelerated2DCanvas', type: 'bool', default: true},
            {key: 'disableHardwareAcceleration', type: 'bool', default: true},
            {key: 'disableSoftwareRasterizer', type: 'bool', default: true},
            {key: 'disableGpu', type: 'bool', default: true},
            {key: 'disableGpuCompositing', type: 'bool', default: true},
            {key: 'rendererProcessLimit', type: 'int', default: 4, min: 0, max: 64}
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

function labelOf(item) {
    return t(`s.${item.key}.label`);
}

/** Groups with labels/descriptions/options resolved in the current language (for the UI). */
function localizedGroups(groups) {
    return groups.map(g => ({
        ...g,
        label: t(`g.${g.id}`),
        items: g.items.map(item => ({
            ...item,
            label: labelOf(item),
            description: t(`s.${item.key}.desc`),
            options: item.options ? item.options.map(value => ({value, label: t(`opt.${item.key}.${value}`)})) : undefined
        }))
    }));
}

/**
 * Coerces and validates a single value against its schema item.
 * Returns {ok: true, value} or {ok: false, error}.
 */
function sanitizeValue(item, raw) {
    const label = labelOf(item);
    switch (item.type) {
        case 'bool': {
            if (typeof raw === 'boolean') return {ok: true, value: raw};
            if (raw === 'true' || raw === 1 || raw === '1') return {ok: true, value: true};
            if (raw === 'false' || raw === 0 || raw === '0') return {ok: true, value: false};
            return {ok: false, error: t('val.bool', {label})};
        }
        case 'int': {
            const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
            if (typeof n !== 'number' || !Number.isFinite(n)) return {ok: false, error: t('val.number', {label})};
            const v = Math.round(n);
            if (item.min !== undefined && v < item.min) return {ok: false, error: t('val.min', {label, n: item.min})};
            if (item.max !== undefined && v > item.max) return {ok: false, error: t('val.max', {label, n: item.max})};
            return {ok: true, value: v};
        }
        case 'string': {
            if (typeof raw !== 'string') return {ok: false, error: t('val.text', {label})};
            const max = item.maxLength || STRING_MAX;
            if (raw.length > max) return {ok: false, error: t('val.maxLength', {label, n: max})};
            return {ok: true, value: raw};
        }
        case 'enum': {
            if (typeof raw === 'string' && item.options.includes(raw)) return {ok: true, value: raw};
            return {ok: false, error: t('val.option', {label})};
        }
        default:
            return {ok: false, error: t('val.unknownType', {key: item.key})};
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
        return {ok: false, errors: [t('err.invalidChange')]};
    }
    const next = {...current};
    const errors = [];
    const changedKeys = [];
    for (const [key, raw] of Object.entries(patch)) {
        const item = items.find(i => i.key === key);
        if (!item) {
            errors.push(t('val.unknownSetting', {key: String(key).slice(0, 64)}));
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
    localizedGroups,
    sanitizeValue,
    sanitizeObject,
    applyPatch
};
