'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {ConfigStore} = require('../src/main/config-store');
const schema = require('../src/main/schema');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'surfer-test-'));
}

test('creates defaults on first start', () => {
    const dir = tmpDir();
    const store = new ConfigStore(dir);
    store.load();
    assert.ok(fs.existsSync(path.join(dir, 'settings.json')));
    assert.deepEqual(store.data.settings, schema.DEFAULT_SETTINGS);
    assert.equal(store.data.surfers.length, 0);
});

test('imports legacy text/json files', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({WINDOW_WIDTH: 800, RELOAD_TIMER: 'abc', UNKNOWN: 1}));
    fs.writeFileSync(path.join(dir, 'surfbar_links.txt'), 'https://shimly.de/surf?id=1\r\n\r\njavascript:alert(1)\nhttps://other.example/surf\n');
    fs.writeFileSync(path.join(dir, 'whitelist.txt'), 'Shimly.de\nhttps://www.foo.com/x\n');
    fs.writeFileSync(path.join(dir, 'user_agent.txt'), 'MyAgent/1.0\n');
    const logs = [];
    const store = new ConfigStore(dir, {log: (l, m) => logs.push(m)});
    store.load();
    assert.equal(store.data.settings.WINDOW_WIDTH, 800);
    assert.equal(store.data.settings.RELOAD_TIMER, 0);
    assert.deepEqual(store.data.surfers.map(s => s.url), ['https://shimly.de/surf?id=1', 'https://other.example/surf']);
    assert.deepEqual(store.data.lists.whitelist, ['shimly.de', 'foo.com']);
    assert.equal(store.data.userAgent, 'MyAgent/1.0');
    assert.ok(logs.some(m => m.includes('übernommen')));
});

test('corrupt settings.json falls back to backup', () => {
    const dir = tmpDir();
    const a = new ConfigStore(dir);
    a.load();
    a.addSurfer({url: 'https://a.example/'});
    a.saveNow();
    const b = new ConfigStore(dir);
    b.load(); // first save of this session writes settings.json.bak
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ broken');
    const c = new ConfigStore(dir);
    c.load();
    assert.equal(c.data.surfers.length, 1);
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith('settings.corrupt-')));
});

test('settings patches are validated as a whole', () => {
    const store = new ConfigStore(tmpDir());
    store.load();
    assert.equal(store.updateSettings({WINDOW_WIDTH: 10}).ok, false);
    assert.equal(store.updateSettings({NOPE: true}).ok, false);
    assert.equal(store.updateSettings({WINDOW_WIDTH: 900, AUTOSTART: 'yes'}).ok, false);
    assert.equal(store.data.settings.WINDOW_WIDTH, 1280);
    const res = store.updateSettings({WINDOW_WIDTH: '900', AUTOSTART: false});
    assert.equal(res.ok, true);
    assert.deepEqual(res.changedKeys.sort(), ['AUTOSTART', 'WINDOW_WIDTH']);
    assert.equal(store.data.settings.WINDOW_WIDTH, 900);
});

test('surfer CRUD with sanitizing', () => {
    const store = new ConfigStore(tmpDir());
    store.load();
    assert.equal(store.addSurfer({url: 'ftp://x'}).ok, false);
    const {value} = store.addSurfer({url: 'surf.example.com/?id=5', name: '  Mein\u0000 Surfer  '});
    assert.equal(value.url, 'https://surf.example.com/?id=5');
    assert.equal(value.name, 'Mein Surfer');
    assert.equal(store.updateSurfer(value.id, {url: 'javascript:1'}).ok, false);
    const upd = store.updateSurfer(value.id, {zoom: 9, isolated: true, id: 'hijack'});
    assert.equal(upd.ok, true);
    assert.equal(store.getSurfer(value.id).zoom, 3);
    assert.equal(store.getSurfer(value.id).isolated, true);
    assert.equal(store.getSurfer('hijack'), null);
    assert.equal(store.removeSurfer(value.id).ok, true);
    assert.equal(store.data.surfers.length, 0);
});

test('lists are normalized and deduplicated', () => {
    const store = new ConfigStore(tmpDir());
    store.load();
    const res = store.setList('blockedDomains', ['YouTube.com', 'www.youtube.com', 'bad domain', '# x', '']);
    assert.deepEqual(res.value, ['youtube.com']);
    assert.deepEqual(res.rejected, ['bad domain']);
    assert.equal(store.setList('__proto__', []).ok, false);
});
