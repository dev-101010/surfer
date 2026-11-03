'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/main/i18n');
const schema = require('../src/main/schema');

const SRC = path.join(__dirname, '..', 'src');

function files(dir, ext) {
    const out = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...files(full, ext));
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

test('German and English contain exactly the same keys', () => {
    const de = Object.keys(i18n.DICTIONARIES.de).sort();
    const en = Object.keys(i18n.DICTIONARIES.en).sort();
    assert.deepEqual(de.filter(k => !en.includes(k)), [], 'missing in en');
    assert.deepEqual(en.filter(k => !de.includes(k)), [], 'missing in de');
});

test('placeholders match between languages', () => {
    const vars = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
    for (const key of Object.keys(i18n.DICTIONARIES.de)) {
        assert.equal(vars(i18n.DICTIONARIES.de[key]), vars(i18n.DICTIONARIES.en[key]), key);
    }
});

test('every key used in code and HTML exists', () => {
    const used = new Set();
    for (const file of files(SRC, '.js')) {
        const text = fs.readFileSync(file, 'utf-8');
        for (const m of text.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    for (const file of files(SRC, '.html')) {
        const text = fs.readFileSync(file, 'utf-8');
        for (const m of text.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) used.add(m[1]);
    }
    // keys built dynamically
    for (const s of ['running', 'loading', 'error', 'crashed', 'stopped']) used.add(`ui.status.${s}`);
    for (const s of ['idle', 'checking', 'none', 'available', 'downloading', 'installing', 'installed', 'error']) used.add(`ui.upd.${s}`);
    for (const l of ['debug', 'info', 'warn', 'error', 'block']) used.add(`ui.lv.${l}`);
    for (const n of ['whitelist', 'blockedDomains', 'blockedExtensions', 'captchaWhitelist']) {
        used.add(`ui.list.${n}.title`);
        used.add(`ui.list.${n}.desc`);
    }
    for (const g of [...schema.SETTINGS_GROUPS, ...schema.BROWSER_GROUPS]) {
        used.add(`g.${g.id}`);
        for (const item of g.items) {
            used.add(`s.${item.key}.label`);
            used.add(`s.${item.key}.desc`);
            for (const o of item.options || []) used.add(`opt.${item.key}.${o}`);
        }
    }
    const missing = [...used].filter(k => !(k in i18n.DICTIONARIES.de));
    assert.deepEqual(missing, []);
    assert.ok(used.size > 200);
});

test('language switching and fallbacks', () => {
    i18n.setLanguage('en');
    assert.equal(i18n.t('ui.nav.settings'), 'Settings');
    assert.equal(i18n.t('sf.started', {url: 'https://x'}), 'Started: https://x');
    i18n.setLanguage('de');
    assert.equal(i18n.t('ui.nav.settings'), 'Einstellungen');
    assert.equal(i18n.t('does.not.exist'), 'does.not.exist');
    assert.equal(i18n.setLanguage('xx'), i18n.detectLanguage());
    assert.equal(i18n.setLanguage('auto'), i18n.detectLanguage());
});

test('validation errors follow the language', () => {
    i18n.setLanguage('en');
    const item = schema.SETTINGS_ITEMS.find(i => i.key === 'WINDOW_WIDTH');
    assert.equal(schema.sanitizeValue(item, 5).error, 'Window width: at least 320');
    i18n.setLanguage('de');
    assert.equal(schema.sanitizeValue(item, 5).error, 'Fensterbreite: mindestens 320');
    const lang = schema.SETTINGS_ITEMS.find(i => i.key === 'LANGUAGE');
    assert.equal(schema.sanitizeValue(lang, 'en').ok, true);
    assert.equal(schema.sanitizeValue(lang, 'fr').ok, false);
});
