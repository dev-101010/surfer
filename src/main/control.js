'use strict';

const path = require('path');
const {app, BrowserWindow, ipcMain, dialog, shell} = require('electron');
const schema = require('./schema');
const {DEFAULT_LISTS, LIST_NAMES} = require('./config-store');
const {uiPreferences, lockDown} = require('./surfer');

const CONTROL_HTML = path.join(__dirname, '..', 'renderer', 'control', 'index.html');
const PRELOAD_CONTROL = path.join(__dirname, '..', 'preload', 'control.js');
const LOG_BATCH_MS = 200;

function isId(v) {
    return typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v);
}

function ok(data) {
    return {ok: true, data};
}

function fail(errors) {
    return {ok: false, errors: Array.isArray(errors) ? errors : [String(errors)]};
}

function fromStore(res) {
    return res.ok ? ok(res) : fail(res.errors);
}

/**
 * The control window (main window) and the whole IPC surface it talks to.
 */
class ControlCenter {
    constructor({store, logger, manager, updater, paths, startupBrowser}) {
        this.store = store;
        this.logger = logger;
        this.manager = manager;
        this.updater = updater;
        this.paths = paths;
        this.startupBrowser = JSON.stringify(startupBrowser);
        this.win = null;
        this.logQueue = [];
        this.logTimer = null;
        this.allowClose = false;
    }

    get restartRequired() {
        return JSON.stringify(this.store.data.browser) !== this.startupBrowser;
    }

    // ---- window ---------------------------------------------------------------------------

    open() {
        if (this.win && !this.win.isDestroyed()) {
            if (this.win.isMinimized()) this.win.restore();
            this.win.show();
            this.win.focus();
            return;
        }
        const saved = this.store.data.ui.controlBounds;
        const bounds = saved && this.manager.isOnScreen(saved) ? saved : {width: 1180, height: 780};
        this.win = new BrowserWindow({
            ...bounds,
            minWidth: 900,
            minHeight: 600,
            show: false,
            title: `Surfer ${app.getVersion()}`,
            backgroundColor: '#0f1115',
            autoHideMenuBar: true,
            webPreferences: uiPreferences(PRELOAD_CONTROL)
        });
        lockDown(this.win.webContents, this.logger);
        this.win.once('ready-to-show', () => this.win.show());
        this.win.loadFile(CONTROL_HTML).catch(err => this.logger.error('Surfer', `Hauptfenster konnte nicht geladen werden: ${err.message}`));

        let boundsTimer = null;
        const saveBounds = () => {
            clearTimeout(boundsTimer);
            boundsTimer = setTimeout(() => {
                if (this.win && !this.win.isDestroyed() && !this.win.isMinimized()) this.store.setControlBounds(this.win.getNormalBounds());
            }, 800);
        };
        this.win.on('resize', saveBounds);
        this.win.on('move', saveBounds);

        this.win.on('close', e => {
            if (this.allowClose) return;
            const running = this.manager.ordered().filter(s => s.running).length;
            if (running > 0) {
                const choice = dialog.showMessageBoxSync(this.win, {
                    type: 'question',
                    buttons: ['Beenden', 'Abbrechen'],
                    defaultId: 1,
                    cancelId: 1,
                    title: 'Surfer beenden',
                    message: `${running} Surfer laufen noch.`,
                    detail: 'Beim Schließen des Hauptfensters werden alle Surfer beendet.'
                });
                if (choice !== 0) {
                    e.preventDefault();
                    return;
                }
            }
            this.allowClose = true;
            app.quit();
        });
        this.win.on('closed', () => {
            this.win = null;
        });
    }

    send(name, data) {
        if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
            this.win.webContents.send('control:event', name, data);
        }
    }

    // ---- wiring ---------------------------------------------------------------------------

    init() {
        ipcMain.handle('control:call', (event, method, payload) => this._dispatch(event, method, payload));

        ipcMain.on('surfer:page-config', event => {
            event.returnValue = this.manager.pageConfig();
        });

        ipcMain.on('toolbar:ready', event => {
            const surfer = this.manager.toolbarOwner(event.sender);
            if (surfer) surfer.pushToolbar();
        });
        ipcMain.on('toolbar:action', (event, action) => {
            const surfer = this.manager.toolbarOwner(event.sender);
            if (!surfer || typeof action !== 'string') return;
            switch (action) {
                case 'back': surfer.back(); break;
                case 'reload': surfer.reload('Werkzeugleiste'); break;
                case 'home': surfer.home(); break;
                case 'zoom-in': surfer.zoom(1); break;
                case 'zoom-out': surfer.zoom(-1); break;
                case 'zoom-reset': surfer.zoom(0); break;
                case 'mute': surfer.toggleMute(); break;
                case 'hide': surfer.hide(); break;
                case 'control': this.open(); break;
                default: break;
            }
        });

        this.manager.on('surfers', list => this.send('surfers', list));
        this.manager.on('stats', stats => this.send('stats', stats));
        this.updater.on('state', s => this.send('update', s));
        this.logger.on('entry', entry => this._queueLog(entry));
        this.logger.on('cleared', () => this.send('log-cleared'));
        this.store.on('change', ({section}) => {
            if (section !== 'surfers') this.send('config', this._configState());
        });
    }

    _queueLog(entry) {
        this.logQueue.push(entry);
        if (this.logQueue.length > 1000) this.logQueue.splice(0, this.logQueue.length - 1000);
        if (this.logTimer) return;
        this.logTimer = setTimeout(() => {
            this.logTimer = null;
            const batch = this.logQueue;
            this.logQueue = [];
            this.send('log', batch);
        }, LOG_BATCH_MS);
    }

    _configState() {
        const d = this.store.data;
        return {
            settings: d.settings,
            browser: d.browser,
            lists: d.lists,
            userAgent: d.userAgent,
            restartRequired: this.restartRequired
        };
    }

    _isTrustedSender(event) {
        return Boolean(this.win && !this.win.isDestroyed()
            && event.sender === this.win.webContents
            && event.senderFrame === event.sender.mainFrame
            && typeof event.senderFrame.url === 'string'
            && event.senderFrame.url.startsWith('file:'));
    }

    async _dispatch(event, method, payload) {
        if (!this._isTrustedSender(event)) return fail('Nicht erlaubt');
        const handler = typeof method === 'string' && Object.prototype.hasOwnProperty.call(this.methods, method) ? this.methods[method] : null;
        if (!handler) return fail('Unbekannte Funktion');
        try {
            return await handler.call(this, payload);
        } catch (err) {
            this.logger.warn('Surfer', `${method}: ${err.message}`);
            return fail(err.message);
        }
    }

    _surfer(id) {
        if (!isId(id)) throw new Error('Ungültige Surfer-ID');
        const surfer = this.manager.get(id);
        if (!surfer) throw new Error('Surfer nicht gefunden');
        return surfer;
    }
}

ControlCenter.prototype.methods = {
    getState() {
        return ok({
            app: {
                version: app.getVersion(),
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node,
                platform: `${process.platform} ${process.arch}`,
                paths: this.paths,
                userAgentDefault: app.userAgentFallback
            },
            schema: {settings: schema.SETTINGS_GROUPS, browser: schema.BROWSER_GROUPS},
            defaults: {lists: DEFAULT_LISTS},
            ...this._configState(),
            surfers: this.manager.snapshots(),
            stats: this.manager.lastStats,
            log: this.logger.entries(),
            update: this.updater.state
        });
    },

    updateSettings(patch) {
        const res = this.store.updateSettings(patch);
        if (res.ok && res.changedKeys.length) this.logger.info('Surfer', `Einstellungen geändert: ${res.changedKeys.join(', ')}`);
        return fromStore(res);
    },

    updateBrowser(patch) {
        const res = this.store.updateBrowser(patch);
        if (res.ok && res.changedKeys.length) this.logger.info('Surfer', `Browser-Einstellungen geändert (Neustart nötig): ${res.changedKeys.join(', ')}`);
        return res.ok ? ok({...res, restartRequired: this.restartRequired}) : fail(res.errors);
    },

    resetSettings() {
        this.store.resetSettings();
        this.logger.info('Surfer', 'Alle Einstellungen auf Standard zurückgesetzt.');
        return ok(this._configState());
    },

    setList(payload) {
        if (!payload || !LIST_NAMES.includes(payload.name) || !Array.isArray(payload.entries)) return fail('Ungültige Liste');
        const res = this.store.setList(payload.name, payload.entries.filter(e => typeof e === 'string'));
        if (res.ok) this.logger.info('Surfer', `Liste ${payload.name} gespeichert (${res.value.length} Einträge${res.rejected.length ? `, ${res.rejected.length} ungültig` : ''}).`);
        return fromStore(res);
    },

    resetList(name) {
        return fromStore(this.store.resetList(name));
    },

    setUserAgent(ua) {
        return fromStore(this.store.setUserAgent(ua));
    },

    addSurfer(input) {
        const res = this.store.addSurfer(input);
        if (!res.ok) return fail(res.errors);
        this.manager.syncSurfers();
        this.logger.info('Surfer', `Surfer hinzugefügt: ${res.value.name} (${res.value.url})`);
        if (input && input.start !== false) this.manager.get(res.value.id).start();
        this.manager.emitSurfersSoon();
        return ok(res.value);
    },

    updateSurfer(payload) {
        if (!payload || !isId(payload.id)) return fail('Ungültige Surfer-ID');
        return fromStore(this.store.updateSurfer(payload.id, payload.patch));
    },

    async removeSurfer(id) {
        if (!isId(id)) return fail('Ungültige Surfer-ID');
        const cfg = this.store.getSurfer(id);
        const res = await this.manager.removeSurfer(id);
        if (res.ok && cfg) this.logger.info('Surfer', `Surfer entfernt: ${cfg.name}`);
        this.manager.emitSurfersSoon();
        return fromStore(res);
    },

    moveSurfer(payload) {
        if (!payload || !isId(payload.id)) return fail('Ungültige Surfer-ID');
        const res = this.store.moveSurfer(payload.id, payload.direction === -1 ? -1 : 1);
        this.manager.emitSurfersSoon();
        return fromStore(res);
    },

    startSurfer(id) {
        this._surfer(id).start();
        return ok();
    },
    stopSurfer(id) {
        this._surfer(id).stop('Hauptfenster');
        return ok();
    },
    reloadSurfer(id) {
        this._surfer(id).reload('Hauptfenster');
        return ok();
    },
    showSurfer(id) {
        this._surfer(id).show();
        return ok();
    },
    hideSurfer(id) {
        this._surfer(id).hide();
        return ok();
    },
    muteSurfer(id) {
        this._surfer(id).toggleMute();
        return ok();
    },
    zoomSurfer(payload) {
        if (!payload) return fail('Ungültig');
        const dir = payload.direction === 1 ? 1 : payload.direction === -1 ? -1 : 0;
        this._surfer(payload.id).zoom(dir);
        return ok();
    },
    async clearSurferData(id) {
        this._surfer(id);
        await this.manager.clearSessionData(id);
        return ok();
    },

    startAll() {
        this.manager.startAll();
        return ok();
    },
    stopAll() {
        this.manager.stopAll();
        return ok();
    },
    reloadAll() {
        this.manager.reloadAll();
        return ok();
    },
    showAll() {
        this.manager.showAll();
        return ok();
    },
    hideAll() {
        this.manager.hideAll();
        return ok();
    },
    tile() {
        return ok(this.manager.tile());
    },

    async clearSharedSession() {
        await this.manager.clearSessionData(null);
        return ok();
    },

    clearLog() {
        this.logger.clear();
        return ok();
    },

    async exportLog() {
        const res = await dialog.showSaveDialog(this.win, {
            title: 'Protokoll exportieren',
            defaultPath: `surfer-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`,
            filters: [{name: 'Text', extensions: ['txt']}]
        });
        if (res.canceled || !res.filePath) return ok(false);
        const text = this.logger.entries()
            .map(e => `${new Date(e.ts).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}`)
            .join('\n');
        await require('fs').promises.writeFile(res.filePath, `${text}\n`, 'utf-8');
        return ok(true);
    },

    async openFolder(which) {
        const dir = which === 'logs' ? this.paths.logs : which === 'data' ? this.paths.userData : this.paths.config;
        require('fs').mkdirSync(dir, {recursive: true});
        const err = await shell.openPath(dir);
        return err ? fail(err) : ok();
    },

    async checkUpdate() {
        return ok(await this.updater.check({userInitiated: true}));
    },

    installUpdate() {
        // runs in the background, progress is pushed via the 'update' event
        this.updater.install().catch(err => this.logger.error('Update', err.message));
        return ok();
    },

    quitApp() {
        this.allowClose = true;
        app.quit();
        return ok();
    },

    restartApp() {
        this.logger.info('Surfer', 'Neustart …');
        this.allowClose = true;
        app.relaunch();
        app.quit();
        return ok();
    }
};

module.exports = {ControlCenter};
