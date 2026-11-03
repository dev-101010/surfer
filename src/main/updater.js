'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFile} = require('child_process');
const {EventEmitter} = require('events');
const {t} = require('./i18n');

const MAX_DOWNLOAD = 50 * 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const DEPS_MARKER = '.surfer-install-deps';
const KEEP_BACKUPS = 3;

// Never touched by an update: user data, installed modules, VCS, backups, IDE files.
const PROTECTED = new Set(['config', 'logs', 'node_modules', '.git', 'backup', 'userdata', '.idea', '.vscode', DEPS_MARKER]);

/** "1.2.10" > "1.2.9", "0.14" < "1.0.0". Non-numeric parts count as 0. */
function compareVersions(a, b) {
    const pa = String(a).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(/[.+-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d > 0 ? 1 : -1;
    }
    return 0;
}

/** Extracts "owner/repo" from a package.json repository field. */
function repoFromPackage(pkg) {
    const field = pkg && pkg.repository;
    const url = typeof field === 'string' ? field : field && field.url;
    if (typeof url !== 'string') return null;
    const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i) || url.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/);
    return m ? `${m[1]}/${m[2]}` : null;
}

function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, {windowsHide: true, timeout: 120000, ...opts}, (err, stdout, stderr) => {
            if (err) reject(new Error(`${path.basename(cmd)}: ${(stderr || err.message).toString().trim().slice(0, 300)}`));
            else resolve(stdout);
        });
    });
}

function tarBinary() {
    if (process.platform === 'win32') {
        const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        if (fs.existsSync(sys)) return sys;
    }
    return 'tar';
}

/** Recursive copy that never follows or creates symlinks and never leaves `dest`. */
function copyTree(src, dest) {
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
        fs.mkdirSync(dest, {recursive: true});
        for (const name of fs.readdirSync(src)) {
            if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) continue;
            copyTree(path.join(src, name), path.join(dest, name));
        }
    } else if (st.isFile()) {
        fs.copyFileSync(src, dest);
    }
}

function readJsonFile(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * Self-update for source installations (ZIP download from GitHub).
 * check(): compares the version in the remote package.json with the local one.
 * install(): downloads the branch tarball, validates it, backs up the current version to
 * backup/<version>-<time>/ and replaces the program files. config/ and logs/ stay untouched.
 */
class Updater extends EventEmitter {
    constructor({appRoot, logger, fetchImpl, isPackaged = false, branch = 'master'}) {
        super();
        this.appRoot = appRoot;
        this.logger = logger;
        this.fetch = fetchImpl || globalThis.fetch;
        this.isPackaged = isPackaged;
        this.branch = branch;
        this.pkg = readJsonFile(path.join(appRoot, 'package.json'));
        this.repo = repoFromPackage(this.pkg);
        this.remotePkg = null;
        this.busy = false;
        this.state = {status: 'idle', current: this.pkg.version, latest: null, progress: 0, message: '', canInstall: false, reason: ''};
    }

    _set(patch) {
        this.state = {...this.state, ...patch};
        this.emit('state', this.state);
    }

    installBlocker() {
        if (!this.repo) return t('upd.noRepo');
        if (this.isPackaged) return t('upd.packaged');
        if (fs.existsSync(path.join(this.appRoot, '.git'))) return t('upd.git');
        try {
            fs.accessSync(this.appRoot, fs.constants.W_OK);
        } catch {
            return t('upd.noWrite', {dir: this.appRoot});
        }
        return '';
    }

    async _fetch(url, timeout) {
        const res = await this.fetch(url, {
            signal: AbortSignal.timeout(timeout),
            headers: {'User-Agent': `Surfer-Updater/${this.pkg.version}`, 'Cache-Control': 'no-cache'},
            redirect: 'follow'
        });
        if (!res.ok) throw new Error(t('upd.http', {status: res.status, host: new URL(url).host}));
        return res;
    }

    async check({userInitiated = false} = {}) {
        if (this.busy) return this.state;
        if (!this.repo) {
            this._set({status: 'error', message: t('upd.noRepo'), userInitiated});
            return this.state;
        }
        this.busy = true;
        this._set({status: 'checking', message: '', userInitiated});
        try {
            const res = await this._fetch(`https://raw.githubusercontent.com/${this.repo}/${this.branch}/package.json`, FETCH_TIMEOUT_MS);
            const text = await res.text();
            if (text.length > MAX_MANIFEST) throw new Error(t('upd.tooLarge'));
            const remote = JSON.parse(text);
            if (!remote || typeof remote.version !== 'string' || !/^\d+(\.\d+){0,3}([-+][\w.]+)?$/.test(remote.version)) {
                throw new Error(t('upd.badVersion'));
            }
            this.remotePkg = remote;
            const newer = compareVersions(remote.version, this.pkg.version) > 0;
            const blocker = this.installBlocker();
            this._set({
                status: newer ? 'available' : 'none',
                latest: remote.version,
                canInstall: newer && !blocker,
                reason: blocker
            });
            if (newer) this.logger.info('Update', t('upd.available', {latest: remote.version, current: this.pkg.version}));
            else if (userInitiated) this.logger.info('Update', t('upd.upToDate', {current: this.pkg.version}));
        } catch (err) {
            const message = err.name === 'TimeoutError' ? t('upd.timeout') : err.message;
            this._set({status: 'error', message});
            (userInitiated ? this.logger.warn : this.logger.debug).call(this.logger, 'Update', t('upd.checkFailed', {error: message}));
        } finally {
            this.busy = false;
        }
        return this.state;
    }

    async install() {
        if (this.busy) return this.state;
        if (this.state.status !== 'available' || !this.remotePkg) throw new Error(t('upd.notAvailable'));
        const blocker = this.installBlocker();
        if (blocker) throw new Error(blocker);

        this.busy = true;
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfer-update-'));
        let backupDir = null;
        let replaced = false;
        try {
            // 1) download
            this._set({status: 'downloading', progress: 0, message: '', userInitiated: true});
            const archive = path.join(tmp, 'update.tar.gz');
            await this._download(`https://codeload.github.com/${this.repo}/tar.gz/refs/heads/${this.branch}`, archive);

            // 2) extract into an empty directory and validate
            this._set({status: 'installing', progress: 1});
            const extractDir = path.join(tmp, 'x');
            fs.mkdirSync(extractDir);
            await run(tarBinary(), ['-xzf', archive, '-C', extractDir]);
            const roots = fs.readdirSync(extractDir).filter(n => fs.lstatSync(path.join(extractDir, n)).isDirectory());
            if (roots.length !== 1) throw new Error(t('upd.badArchive'));
            const newRoot = path.join(extractDir, roots[0]);
            const newPkg = readJsonFile(path.join(newRoot, 'package.json'));
            if (String(newPkg.name).toLowerCase() !== String(this.pkg.name).toLowerCase()) throw new Error(t('upd.wrongArchive'));
            if (compareVersions(newPkg.version, this.pkg.version) <= 0) throw new Error(t('upd.notNewer', {version: newPkg.version}));
            const mainFile = path.resolve(newRoot, newPkg.main || 'index.js');
            if (!mainFile.startsWith(newRoot + path.sep) || !fs.existsSync(mainFile)) throw new Error(t('upd.incomplete'));

            // 3) back up the current program files
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            backupDir = path.join(this.appRoot, 'backup', `${this.pkg.version}-${stamp}`);
            fs.mkdirSync(backupDir, {recursive: true});
            for (const name of fs.readdirSync(this.appRoot)) {
                if (PROTECTED.has(name)) continue;
                copyTree(path.join(this.appRoot, name), path.join(backupDir, name));
            }

            // 4) replace program files (directories are replaced as a whole so removed files vanish)
            replaced = true;
            for (const name of fs.readdirSync(newRoot)) {
                if (PROTECTED.has(name)) continue;
                const src = path.join(newRoot, name);
                const dest = path.join(this.appRoot, name);
                const st = fs.lstatSync(src);
                if (st.isSymbolicLink()) continue;
                if (st.isDirectory()) fs.rmSync(dest, {recursive: true, force: true});
                copyTree(src, dest);
                if (process.platform !== 'win32' && name.endsWith('.sh')) fs.chmodSync(dest, 0o755);
            }

            const depsChanged = JSON.stringify(newPkg.dependencies || {}) !== JSON.stringify(this.pkg.dependencies || {});
            if (depsChanged) fs.writeFileSync(path.join(this.appRoot, DEPS_MARKER), `${newPkg.version}\n`, 'utf-8');

            this._pruneBackups();
            const relBackup = path.relative(this.appRoot, backupDir);
            this.logger.info('Update', `${t('upd.installed', {version: newPkg.version, backup: relBackup})}${depsChanged ? ` · ${t('upd.installedDeps')}` : ''}`);
            this._set({status: 'installed', latest: newPkg.version, needsDependencyInstall: depsChanged, backup: relBackup, canInstall: false});
        } catch (err) {
            let message = err.message;
            if (replaced && backupDir) {
                try {
                    for (const name of fs.readdirSync(backupDir)) {
                        const dest = path.join(this.appRoot, name);
                        if (fs.lstatSync(path.join(backupDir, name)).isDirectory()) fs.rmSync(dest, {recursive: true, force: true});
                        copyTree(path.join(backupDir, name), dest);
                    }
                    message += ` – ${t('upd.restored')}`;
                } catch (restoreErr) {
                    message += ` – ${t('upd.restoreFailed', {error: restoreErr.message, dir: backupDir})}`;
                }
            }
            this.logger.error('Update', t('upd.installFailed', {error: message}));
            this._set({status: 'error', message, userInitiated: true});
        } finally {
            this.busy = false;
            fs.rm(tmp, {recursive: true, force: true}, () => {});
        }
        return this.state;
    }

    /** Keeps only the newest KEEP_BACKUPS backup folders. */
    _pruneBackups() {
        const dir = path.join(this.appRoot, 'backup');
        try {
            const entries = fs.readdirSync(dir)
                .map(name => ({name, full: path.join(dir, name)}))
                .filter(e => fs.lstatSync(e.full).isDirectory())
                .map(e => ({...e, mtime: fs.statSync(e.full).mtimeMs}))
                .sort((a, b) => b.mtime - a.mtime);
            for (const old of entries.slice(KEEP_BACKUPS)) fs.rmSync(old.full, {recursive: true, force: true});
        } catch { /* best effort */ }
    }

    async _download(url, file) {
        const res = await this._fetch(url, DOWNLOAD_TIMEOUT_MS);
        const total = Number(res.headers.get('content-length')) || 0;
        if (total > MAX_DOWNLOAD) throw new Error(t('upd.downloadTooLarge'));
        const out = fs.createWriteStream(file);
        let received = 0;
        let lastEmit = 0;
        try {
            const reader = res.body.getReader();
            for (; ;) {
                const {done, value} = await reader.read();
                if (done) break;
                received += value.length;
                if (received > MAX_DOWNLOAD) throw new Error(t('upd.downloadTooLarge'));
                if (!out.write(value)) await new Promise(r => out.once('drain', r));
                const now = Date.now();
                if (now - lastEmit > 200) {
                    lastEmit = now;
                    this._set({progress: total ? received / total : 0.5, message: `${(received / 1048576).toFixed(1)} MB`});
                }
            }
        } finally {
            await new Promise(r => out.end(r));
        }
        if (received < 64) throw new Error(t('upd.downloadIncomplete')); // truncated archives are rejected by tar
    }
}

module.exports = {Updater, compareVersions, repoFromPackage, tarBinary, DEPS_MARKER};
