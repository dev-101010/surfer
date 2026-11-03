'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {EventEmitter} = require('events');
const schema = require('./schema');
const {normalizeDomain, normalizeExtension, normalizeHttpUrl, displayHost} = require('./domain');
const {t} = require('./i18n');

const FILE_VERSION = 2;
const MAX_SURFERS = 100;
const MAX_LIST_ENTRIES = 5000;
const MAX_NAME_LENGTH = 60;
const MAX_UA_LENGTH = 512;

const DEFAULT_LISTS = Object.freeze({
    whitelist: ['shimly.de', 'shimly.net'],
    blockedDomains: ['youtube.com', 'netflix.com', 'twitch.tv', 'dailymotion.com', 'spotify.com'],
    blockedExtensions: ['.m3u8', '.mpd', '.mp3', '.mp4', '.ogg', '.wav', '.webm', '.mkv', '.flac', '.avi'],
    captchaWhitelist: ['cloudflare.com', 'hcaptcha.com', 'recaptcha.net']
});

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/118.0';

const LIST_NAMES = Object.freeze(Object.keys(DEFAULT_LISTS));

const LIST_NORMALIZERS = {
    whitelist: normalizeDomain,
    blockedDomains: normalizeDomain,
    captchaWhitelist: normalizeDomain,
    blockedExtensions: normalizeExtension
};

const LEGACY_FILES = {
    config: 'config.json',
    browser: 'browser_deep_config.json',
    whitelist: 'whitelist.txt',
    blockedDomains: 'blocked_domains.txt',
    blockedExtensions: 'blocked_extensions.txt',
    captchaWhitelist: 'captcha_whitelist.txt',
    surfbarLinks: 'surfbar_links.txt',
    userAgent: 'user_agent.txt'
};

function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    // strip control characters, collapse whitespace
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeList(name, entries) {
    const normalize = LIST_NORMALIZERS[name];
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    const src = Array.isArray(entries) ? entries : [];
    for (const raw of src) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const value = normalize(trimmed);
        if (!value) {
            rejected.push(trimmed.slice(0, 200));
            continue;
        }
        if (seen.has(value)) continue;
        if (accepted.length >= MAX_LIST_ENTRIES) {
            rejected.push(trimmed.slice(0, 200));
            continue;
        }
        seen.add(value);
        accepted.push(value);
    }
    return {accepted, rejected};
}

function sanitizeBounds(b) {
    if (!b || typeof b !== 'object') return null;
    const out = {};
    for (const k of ['x', 'y', 'width', 'height']) {
        const v = b[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        out[k] = Math.round(v);
    }
    if (out.width < 200 || out.height < 150 || out.width > 16000 || out.height > 16000) return null;
    if (Math.abs(out.x) > 100000 || Math.abs(out.y) > 100000) return null;
    return out;
}

function sanitizeZoom(z) {
    const n = Number(z);
    if (!Number.isFinite(n)) return 1;
    return Math.min(3, Math.max(0.25, Math.round(n * 100) / 100));
}

function newId() {
    return crypto.randomUUID();
}

/** Returns a valid surfer object or null. `fallback` supplies values for missing fields. */
function sanitizeSurfer(raw, fallback = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const url = normalizeHttpUrl(raw.url !== undefined ? raw.url : fallback.url);
    if (!url) return null;
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : (fallback.id || newId());
    const nameSrc = raw.name !== undefined ? raw.name : fallback.name;
    const name = cleanText(nameSrc, MAX_NAME_LENGTH) || displayHost(url) || 'Surfer';
    const pick = (key, def) => typeof raw[key] === 'boolean' ? raw[key] : (typeof fallback[key] === 'boolean' ? fallback[key] : def);
    return {
        id,
        name,
        url,
        autostart: pick('autostart', true),
        isolated: pick('isolated', false),
        zoom: sanitizeZoom(raw.zoom !== undefined ? raw.zoom : fallback.zoom),
        bounds: sanitizeBounds(raw.bounds !== undefined ? raw.bounds : fallback.bounds)
    };
}

function readTextLines(file) {
    try {
        return fs.readFileSync(file, 'utf-8').split(/\r?\n/);
    } catch {
        return null;
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

class ConfigStore extends EventEmitter {
    /**
     * @param {string} dir directory holding settings.json
     * @param {{log?: (level: string, msg: string) => void}} [opts]
     */
    constructor(dir, opts = {}) {
        super();
        this.dir = dir;
        this.file = path.join(dir, 'settings.json');
        this.log = opts.log || (() => {});
        this.data = null;
        this._saveTimer = null;
        this._backedUp = false;
    }

    defaults() {
        return {
            version: FILE_VERSION,
            settings: {...schema.DEFAULT_SETTINGS},
            browser: {...schema.DEFAULT_BROWSER},
            lists: {
                whitelist: [...DEFAULT_LISTS.whitelist],
                blockedDomains: [...DEFAULT_LISTS.blockedDomains],
                blockedExtensions: [...DEFAULT_LISTS.blockedExtensions],
                captchaWhitelist: [...DEFAULT_LISTS.captchaWhitelist]
            },
            userAgent: DEFAULT_USER_AGENT,
            surfers: [],
            ui: {controlBounds: null}
        };
    }

    /** Validates an arbitrary object into a complete data structure. */
    sanitize(raw) {
        const d = this.defaults();
        if (!raw || typeof raw !== 'object') return {data: d, issues: [t('cfg.emptyOrInvalid')]};
        const issues = [];

        const s = schema.sanitizeObject(schema.SETTINGS_ITEMS, raw.settings, d.settings);
        issues.push(...s.errors);
        d.settings = s.value;

        const b = schema.sanitizeObject(schema.BROWSER_ITEMS, raw.browser, d.browser);
        issues.push(...b.errors);
        d.browser = b.value;

        if (raw.lists && typeof raw.lists === 'object') {
            for (const name of LIST_NAMES) {
                if (!Array.isArray(raw.lists[name])) continue;
                const {accepted, rejected} = normalizeList(name, raw.lists[name]);
                d.lists[name] = accepted;
                if (rejected.length) issues.push(t('cfg.listRejected', {list: name, n: rejected.length}));
            }
        }

        if (typeof raw.userAgent === 'string') d.userAgent = cleanText(raw.userAgent, MAX_UA_LENGTH);

        if (Array.isArray(raw.surfers)) {
            const ids = new Set();
            for (const entry of raw.surfers.slice(0, MAX_SURFERS)) {
                const surfer = sanitizeSurfer(entry);
                if (!surfer) {
                    issues.push(t('cfg.invalidSurfer'));
                    continue;
                }
                if (ids.has(surfer.id)) surfer.id = newId();
                ids.add(surfer.id);
                d.surfers.push(surfer);
            }
        }

        if (raw.ui && typeof raw.ui === 'object') {
            d.ui.controlBounds = sanitizeBounds(raw.ui.controlBounds);
        }
        return {data: d, issues};
    }

    load() {
        fs.mkdirSync(this.dir, {recursive: true});
        if (!fs.existsSync(this.file)) {
            const legacy = this._importLegacy();
            this.data = legacy || this.defaults();
            this.saveNow();
            if (legacy) {
                this.log('info', t('cfg.migrated', {dir: this.dir, n: this.data.surfers.length}));
            } else {
                this.log('info', t('cfg.created', {file: this.file}));
            }
            return this.data;
        }

        let raw = readJson(this.file);
        if (raw === null) {
            const corrupt = path.join(this.dir, `settings.corrupt-${Date.now()}.json`);
            try {
                fs.renameSync(this.file, corrupt);
            } catch { /* ignore */ }
            this.log('error', t('cfg.corrupt', {file: path.basename(corrupt)}));
            raw = readJson(`${this.file}.bak`);
            if (raw) this.log('warn', t('cfg.useBackup'));
        }

        const {data, issues} = this.sanitize(raw);
        this.data = data;
        for (const issue of issues) this.log('warn', t('cfg.issue', {issue}));
        this.saveNow();
        return this.data;
    }

    _importLegacy() {
        const p = name => path.join(this.dir, LEGACY_FILES[name]);
        const hasAny = Object.keys(LEGACY_FILES).some(k => fs.existsSync(p(k)));
        if (!hasAny) return null;

        const raw = {settings: readJson(p('config')) || {}, browser: readJson(p('browser')) || {}, lists: {}};
        for (const name of LIST_NAMES) {
            const lines = readTextLines(p(name));
            if (lines) raw.lists[name] = lines;
        }
        const ua = readTextLines(p('userAgent'));
        if (ua) raw.userAgent = ua.join(' ').trim() || DEFAULT_USER_AGENT;
        const links = readTextLines(p('surfbarLinks')) || [];
        raw.surfers = links.map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(url => ({url}));
        const {data, issues} = this.sanitize(raw);
        for (const issue of issues) this.log('warn', t('cfg.importIssue', {issue}));
        return data;
    }

    save() {
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this.saveNow(), 300);
    }

    saveNow() {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        if (!this.data) return;
        const json = JSON.stringify(this.data, null, 2);
        const tmp = `${this.file}.tmp`;
        try {
            if (!this._backedUp && fs.existsSync(this.file)) {
                fs.copyFileSync(this.file, `${this.file}.bak`);
                this._backedUp = true;
            }
            fs.writeFileSync(tmp, json, 'utf-8');
            try {
                fs.renameSync(tmp, this.file);
            } catch {
                // Windows: target may be locked (virus scanner, editor). Fall back to direct write.
                fs.writeFileSync(this.file, json, 'utf-8');
                try {
                    fs.unlinkSync(tmp);
                } catch { /* ignore */ }
            }
        } catch (err) {
            this.log('error', t('cfg.saveFailed', {error: err.message}));
        }
    }

    // ---- settings -------------------------------------------------------------------------

    updateSettings(patch) {
        const res = schema.applyPatch(schema.SETTINGS_ITEMS, this.data.settings, patch);
        if (!res.ok) return res;
        if (res.changedKeys.length) {
            this.data.settings = res.value;
            this.save();
            this.emit('change', {section: 'settings', keys: res.changedKeys});
        }
        return {ok: true, value: this.data.settings, changedKeys: res.changedKeys};
    }

    updateBrowser(patch) {
        const res = schema.applyPatch(schema.BROWSER_ITEMS, this.data.browser, patch);
        if (!res.ok) return res;
        if (res.changedKeys.length) {
            this.data.browser = res.value;
            this.save();
            this.emit('change', {section: 'browser', keys: res.changedKeys});
        }
        return {ok: true, value: this.data.browser, changedKeys: res.changedKeys};
    }

    resetSettings() {
        this.data.settings = {...schema.DEFAULT_SETTINGS};
        this.data.browser = {...schema.DEFAULT_BROWSER};
        this.save();
        this.emit('change', {section: 'settings', keys: Object.keys(this.data.settings)});
        this.emit('change', {section: 'browser', keys: Object.keys(this.data.browser)});
        return {ok: true};
    }

    // ---- lists ----------------------------------------------------------------------------

    setList(name, entries) {
        if (!LIST_NAMES.includes(name)) return {ok: false, errors: [t('err.unknownList')]};
        if (!Array.isArray(entries)) return {ok: false, errors: [t('err.listExpected')]};
        const {accepted, rejected} = normalizeList(name, entries.slice(0, MAX_LIST_ENTRIES * 2));
        this.data.lists[name] = accepted;
        this.save();
        this.emit('change', {section: 'lists', keys: [name]});
        return {ok: true, value: accepted, rejected};
    }

    resetList(name) {
        if (!LIST_NAMES.includes(name)) return {ok: false, errors: [t('err.unknownList')]};
        return this.setList(name, [...DEFAULT_LISTS[name]]);
    }

    setUserAgent(ua) {
        if (typeof ua !== 'string') return {ok: false, errors: [t('err.textExpected')]};
        const value = cleanText(ua, MAX_UA_LENGTH);
        this.data.userAgent = value;
        this.save();
        this.emit('change', {section: 'userAgent', keys: ['userAgent']});
        return {ok: true, value};
    }

    // ---- surfers --------------------------------------------------------------------------

    getSurfer(id) {
        return this.data.surfers.find(s => s.id === id) || null;
    }

    addSurfer(input) {
        if (this.data.surfers.length >= MAX_SURFERS) return {ok: false, errors: [t('err.maxSurfers', {n: MAX_SURFERS})]};
        if (!input || typeof input !== 'object') return {ok: false, errors: [t('err.invalidInput')]};
        const surfer = sanitizeSurfer({...input, id: undefined, bounds: null});
        if (!surfer) return {ok: false, errors: [t('err.invalidUrl')]};
        this.data.surfers.push(surfer);
        this.save();
        this.emit('change', {section: 'surfers', keys: [surfer.id]});
        return {ok: true, value: surfer};
    }

    updateSurfer(id, patch) {
        const current = this.getSurfer(id);
        if (!current) return {ok: false, errors: [t('err.surferNotFound')]};
        if (!patch || typeof patch !== 'object') return {ok: false, errors: [t('err.invalidChange')]};
        if (patch.url !== undefined && !normalizeHttpUrl(patch.url)) {
            return {ok: false, errors: [t('err.invalidUrl')]};
        }
        const allowed = {};
        for (const k of ['name', 'url', 'autostart', 'isolated', 'zoom', 'bounds']) if (k in patch) allowed[k] = patch[k];
        const next = sanitizeSurfer({...current, ...allowed, id}, current);
        if (!next) return {ok: false, errors: [t('err.invalidChange')]};
        const changedKeys = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify(current[k]));
        Object.assign(current, next);
        if (changedKeys.length) {
            this.save();
            // bounds changes are frequent and internal – don't broadcast them
            const fields = changedKeys.filter(k => k !== 'bounds');
            if (fields.length) this.emit('change', {section: 'surfers', keys: [id], fields});
        }
        return {ok: true, value: current, changedKeys};
    }

    removeSurfer(id) {
        const idx = this.data.surfers.findIndex(s => s.id === id);
        if (idx < 0) return {ok: false, errors: [t('err.surferNotFound')]};
        const [removed] = this.data.surfers.splice(idx, 1);
        this.save();
        this.emit('change', {section: 'surfers', keys: [id]});
        return {ok: true, value: removed};
    }

    moveSurfer(id, direction) {
        const idx = this.data.surfers.findIndex(s => s.id === id);
        const to = idx + (direction < 0 ? -1 : 1);
        if (idx < 0 || to < 0 || to >= this.data.surfers.length) return {ok: false, errors: [t('err.cannotMove')]};
        const list = this.data.surfers;
        [list[idx], list[to]] = [list[to], list[idx]];
        this.save();
        this.emit('change', {section: 'surfers', keys: [id]});
        return {ok: true};
    }

    setControlBounds(bounds) {
        this.data.ui.controlBounds = sanitizeBounds(bounds);
        this.save();
    }
}

module.exports = {
    ConfigStore,
    DEFAULT_LISTS,
    DEFAULT_USER_AGENT,
    LIST_NAMES,
    MAX_SURFERS,
    normalizeList,
    sanitizeSurfer
};
