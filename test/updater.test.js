'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {compareVersions, repoFromPackage} = require('../src/main/updater');

test('compareVersions', () => {
    assert.equal(compareVersions('1.0.0', '0.14'), 1);
    assert.equal(compareVersions('0.14', '0.9'), 1);
    assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
    assert.equal(compareVersions('1.0', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});

test('repoFromPackage', () => {
    assert.equal(repoFromPackage({repository: {url: 'https://github.com/dev-101010/surfer.git'}}), 'dev-101010/surfer');
    assert.equal(repoFromPackage({repository: 'github:dev-101010/surfer'}), 'dev-101010/surfer');
    assert.equal(repoFromPackage({repository: 'git@github.com:dev-101010/surfer.git'}), 'dev-101010/surfer');
    assert.equal(repoFromPackage({}), null);
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {Updater, tarBinary, DEPS_MARKER} = require('../src/main/updater');

function write(file, content) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
}

function setup() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surfer-upd-'));
    const root = path.join(base, 'app');
    const pkg = {name: 'Surfer', version: '1.0.0', main: 'src/main/main.js', repository: 'github:o/r', dependencies: {electron: '^45.0.0'}};
    write(path.join(root, 'package.json'), JSON.stringify(pkg));
    write(path.join(root, 'src/main/main.js'), 'old');
    write(path.join(root, 'src/main/removed.js'), 'gone after update');
    write(path.join(root, 'config/settings.json'), '{"keep":true}');

    const src = path.join(base, 'remote', 'surfer-master');
    const newPkg = {...pkg, version: '1.1.0', dependencies: {electron: '^46.0.0'}};
    write(path.join(src, 'package.json'), JSON.stringify(newPkg));
    write(path.join(src, 'src/main/main.js'), 'new');
    write(path.join(src, 'config/settings.json'), '{"overwritten":true}');
    const tarball = path.join(base, 'remote.tar.gz');
    execFileSync(tarBinary(), ['-czf', tarball, '-C', path.join(base, 'remote'), 'surfer-master']);

    const fetchImpl = async url => url.includes('raw.githubusercontent.com')
        ? new Response(JSON.stringify(newPkg))
        : new Response(fs.readFileSync(tarball));
    const logger = {info() {}, warn() {}, error() {}, debug() {}};
    return {root, updater: new Updater({appRoot: root, logger, fetchImpl})};
}

test('update: check, download, backup, replace, keep config', async () => {
    const {root, updater} = setup();
    const checked = await updater.check({userInitiated: true});
    assert.equal(checked.status, 'available');
    assert.equal(checked.latest, '1.1.0');
    assert.equal(checked.canInstall, true);

    const res = await updater.install();
    assert.equal(res.status, 'installed', res.message);
    assert.equal(fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf-8'), 'new');
    assert.equal(fs.existsSync(path.join(root, 'src/main/removed.js')), false);
    assert.equal(fs.readFileSync(path.join(root, 'config/settings.json'), 'utf-8'), '{"keep":true}');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version, '1.1.0');
    assert.equal(res.needsDependencyInstall, true);
    assert.ok(fs.existsSync(path.join(root, DEPS_MARKER)));
    const backup = path.join(root, res.backup);
    assert.equal(fs.readFileSync(path.join(backup, 'src/main/main.js'), 'utf-8'), 'old');
    assert.equal(fs.existsSync(path.join(backup, 'config')), false);
});

test('update: git checkouts are never overwritten', async () => {
    const {root, updater} = setup();
    fs.mkdirSync(path.join(root, '.git'));
    const checked = await updater.check();
    assert.equal(checked.status, 'available');
    assert.equal(checked.canInstall, false);
    await assert.rejects(updater.install(), /git pull/);
    assert.equal(fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf-8'), 'old');
});
