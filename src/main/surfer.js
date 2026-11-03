'use strict';

const path = require('path');
const {BaseWindow, WebContentsView} = require('electron');
const {displayHost} = require('./domain');

const TOOLBAR_HEIGHT = 40;
const PRELOAD_CONTENT = path.join(__dirname, '..', 'preload', 'content.js');
const PRELOAD_TOOLBAR = path.join(__dirname, '..', 'preload', 'toolbar.js');
const TOOLBAR_HTML = path.join(__dirname, '..', 'renderer', 'toolbar', 'index.html');
const FAILURE_RESET_MS = 5 * 60 * 1000;
const STALL_CHECK_MS = 5000;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** webPreferences for untrusted surfbar content (main view and popups). */
function contentPreferences(settings, extra = {}) {
    return {
        preload: PRELOAD_CONTENT,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: true, // preload (visibility patch) runs in every frame
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        enableWebSQL: false,
        devTools: false,
        disableDialogs: settings.BLOCK_DIALOGS,
        backgroundThrottling: settings.BACKGROUND_THROTTLING,
        autoplayPolicy: 'document-user-activation-required',
        disableBlinkFeatures: 'MediaStream,EncryptedMedia',
        ...extra
    };
}

/** webPreferences for our own trusted UI pages. */
function uiPreferences(preload) {
    return {
        preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
        devTools: !require('electron').app.isPackaged && process.env.SURFER_DEVTOOLS === '1'
    };
}

/** Prevents a trusted UI page from ever navigating away or opening windows. Forwards its errors to the log. */
function lockDown(webContents, logger) {
    if (logger) {
        webContents.on('console-message', details => {
            if (details.level === 'error' || details.level === 'warning') {
                logger.log(details.level === 'error' ? 'error' : 'warn', 'UI', `${details.message} (${String(details.sourceId || '').split('/').pop()}:${details.lineNumber})`);
            }
        });
        webContents.on('preload-error', (_e, preloadPath, error) => logger.error('UI', `Preload-Fehler ${path.basename(preloadPath)}: ${error.message}`));
    }
    webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    webContents.on('will-navigate', e => e.preventDefault());
    webContents.on('will-redirect', e => e.preventDefault());
}

function freshState() {
    return {
        status: 'stopped', // stopped | loading | running | error | crashed
        title: '',
        currentUrl: '',
        startedAt: 0,
        reloads: 0,
        blocked: 0,
        crashes: 0,
        lastActivity: 0,
        pid: 0,
        cpu: 0,
        memoryMB: 0,
        error: '',
        visible: false,
        muted: true,
        loading: false,
        recoveryAt: 0
    };
}

/**
 * One surfer = one sub window (BaseWindow) with a toolbar view and a sandboxed content view.
 */
class Surfer {
    /**
     * @param {import('./surfer-manager').SurferManager} manager
     * @param {string} id
     */
    constructor(manager, id) {
        this.manager = manager;
        this.id = id;
        this.win = null;
        this.content = null;
        this.toolbar = null;
        this.popups = new Set();
        this.state = freshState();
        this.timers = {};
        this.failures = 0;
        this.lastFailureAt = 0;
        this.overloadCount = 0;
        this.stopping = false;
        this.lastLoggedTitle = '';
    }

    get cfg() {
        return this.manager.store.getSurfer(this.id);
    }

    get settings() {
        return this.manager.store.data.settings;
    }

    get running() {
        return Boolean(this.win && !this.win.isDestroyed());
    }

    get name() {
        const cfg = this.cfg;
        return cfg ? cfg.name : this.id;
    }

    get webContents() {
        return this.content && !this.content.webContents.isDestroyed() ? this.content.webContents : null;
    }

    log(level, message) {
        this.manager.logger.log(level, this.name, message);
    }

    // ---- lifecycle ------------------------------------------------------------------------

    start() {
        if (this.running) {
            this.show();
            return;
        }
        const cfg = this.cfg;
        if (!cfg) return;
        const s = this.settings;
        const ses = this.manager.sessionFor(cfg);

        let bounds = {width: s.WINDOW_WIDTH, height: s.WINDOW_HEIGHT};
        if (s.REMEMBER_BOUNDS && cfg.bounds && this.manager.isOnScreen(cfg.bounds)) bounds = cfg.bounds;

        this.stopping = false;
        this.state = {...freshState(), status: 'loading', startedAt: Date.now(), lastActivity: Date.now(), muted: s.MUTE_AUDIO};
        this.overloadCount = 0;

        this.win = new BaseWindow({
            ...bounds,
            minWidth: 320,
            minHeight: 240,
            show: false,
            title: cfg.name,
            skipTaskbar: !s.SHOW_IN_TASKBAR,
            backgroundColor: '#14161b',
            autoHideMenuBar: true
        });

        this.content = new WebContentsView({webPreferences: contentPreferences(s, {session: ses, zoomFactor: cfg.zoom})});
        this.content.setBackgroundColor('#ffffff');
        this.win.contentView.addChildView(this.content);
        if (s.SHOW_TOOLBAR) this._createToolbar();
        this._layout();

        this._bindWindow();
        this._bindContent(this.content.webContents);
        this.manager.attachContents(this, this.content.webContents);

        this.log('info', `Gestartet: ${cfg.url}`);
        this._load(cfg.url);

        if (!s.START_HIDDEN) this.win.showInactive();
        this.state.visible = this.win.isVisible();
        this._restartTimers();
        this.changed();
    }

    stop(reason) {
        if (!this.running) return;
        this.stopping = true;
        if (reason) this.log('info', `Gestoppt (${reason})`);
        this._saveBounds(true);
        this.win.close(); // -> 'closed' -> _cleanup()
    }

    async restart() {
        if (this.running) {
            const closed = new Promise(resolve => this.win.once('closed', resolve));
            this.stop('Neustart');
            await closed;
        }
        this.start();
    }

    _cleanup() {
        for (const t of Object.values(this.timers)) {
            clearTimeout(t);
            clearInterval(t);
        }
        this.timers = {};
        for (const popup of this.popups) {
            if (!popup.isDestroyed()) popup.destroy();
        }
        this.popups.clear();
        // WebContentsViews are not destroyed with their window – close them explicitly.
        for (const view of [this.content, this.toolbar]) {
            try {
                if (view && !view.webContents.isDestroyed()) view.webContents.close();
            } catch { /* ignore */ }
        }
        this.win = null;
        this.content = null;
        this.toolbar = null;
        const {reloads, blocked, crashes} = this.state;
        this.state = {...freshState(), reloads, blocked, crashes};
        if (!this.stopping) this.log('info', 'Fenster geschlossen');
        this.stopping = false;
        this.changed();
    }

    // ---- window & views -------------------------------------------------------------------

    _createToolbar() {
        if (this.toolbar || !this.running) return;
        this.toolbar = new WebContentsView({webPreferences: uiPreferences(PRELOAD_TOOLBAR)});
        this.toolbar.setBackgroundColor('#14161b');
        lockDown(this.toolbar.webContents, this.manager.logger);
        this.manager.registerToolbar(this, this.toolbar.webContents);
        this.toolbar.webContents.loadFile(TOOLBAR_HTML).catch(() => {});
        this.win.contentView.addChildView(this.toolbar);
    }

    _removeToolbar() {
        if (!this.toolbar) return;
        try {
            this.win.contentView.removeChildView(this.toolbar);
            this.toolbar.webContents.close();
        } catch { /* ignore */ }
        this.toolbar = null;
    }

    _layout() {
        if (!this.running) return;
        const {width, height} = this.win.getContentBounds();
        const tb = this.toolbar ? TOOLBAR_HEIGHT : 0;
        if (this.toolbar) this.toolbar.setBounds({x: 0, y: 0, width, height: tb});
        this.content.setBounds({x: 0, y: tb, width, height: Math.max(0, height - tb)});
    }

    _bindWindow() {
        const win = this.win;
        win.on('resize', () => {
            this._layout();
            this._saveBounds();
        });
        win.on('move', () => this._saveBounds());
        win.on('show', () => {
            this.state.visible = true;
            this.changed();
        });
        win.on('hide', () => {
            this.state.visible = false;
            this.changed();
        });
        win.on('closed', () => this._cleanup());
    }

    _saveBounds(immediate = false) {
        if (!this.running || !this.settings.REMEMBER_BOUNDS) return;
        clearTimeout(this.timers.bounds);
        const save = () => {
            if (!this.running || this.win.isMinimized()) return;
            this.manager.store.updateSurfer(this.id, {bounds: this.win.getNormalBounds()});
        };
        if (immediate) save();
        else this.timers.bounds = setTimeout(save, 1000);
    }

    // ---- content events -------------------------------------------------------------------

    _bindContent(wc) {
        const activity = () => {
            this.state.lastActivity = Date.now();
        };

        wc.on('did-start-loading', () => {
            this.state.loading = true;
            this.changed();
        });
        wc.on('did-stop-loading', () => {
            this.state.loading = false;
            this.changed();
        });
        wc.on('did-navigate', (_e, url) => {
            this.state.currentUrl = url;
            activity();
            this.changed();
        });
        wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
            if (isMainFrame) this.state.currentUrl = url;
            activity();
            this.changed();
        });
        wc.on('did-frame-navigate', activity);
        wc.on('page-title-updated', (_e, title) => {
            this.state.title = String(title || '').slice(0, 300);
            activity();
            if (this.running) this.win.setTitle(this.state.title ? `${this.name} · ${this.state.title}` : this.name);
            if (this.state.title && this.state.title !== this.lastLoggedTitle) {
                this.lastLoggedTitle = this.state.title;
                this.log('info', `Titel: ${this.state.title}`);
            }
            this.changed();
        });
        wc.on('did-finish-load', () => {
            // Chromium also "finishes" its own error page – keep the error until the next load.
            if (this.state.status === 'error' || wc.getURL().startsWith('chrome-error:')) return;
            this.state.status = 'running';
            this.state.error = '';
            this.state.recoveryAt = 0;
            this.state.pid = wc.getOSProcessId();
            const zoom = this.cfg ? this.cfg.zoom : 1;
            if (Math.abs(wc.getZoomFactor() - zoom) > 0.001) wc.setZoomFactor(zoom);
            this.changed();
        });
        wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
            // -3 = ERR_ABORTED (navigation replaced, user stop, blocked by us)
            if (!isMainFrame || code === -3) return;
            this.state.status = 'error';
            this.state.error = `${description || 'Ladefehler'} (${code})`;
            this.log('error', `Seite konnte nicht geladen werden: ${this.state.error} – ${url}`);
            this._scheduleRecovery('Ladefehler');
            this.changed();
        });
        wc.on('render-process-gone', (_e, details) => {
            if (this.stopping || !this.running) return;
            this.state.crashes++;
            this.state.status = 'crashed';
            this.state.error = `Renderer beendet: ${details.reason} (Code ${details.exitCode})`;
            this.log('error', this.state.error);
            this._scheduleRecovery('Absturz');
            this.changed();
        });
        wc.on('unresponsive', () => {
            const timeout = this.settings.UNRESPONSIVE_TIMEOUT;
            this.log('warn', `Seite reagiert nicht – wird nach ${timeout} s beendet, falls das so bleibt.`);
            clearTimeout(this.timers.unresponsive);
            this.timers.unresponsive = setTimeout(() => {
                if (!this.webContents) return;
                this.log('error', 'Seite hängt – Renderer wird beendet.');
                try {
                    this.webContents.forcefullyCrashRenderer();
                } catch { /* ignore */ }
                if (!this.settings.CRASH_RESTART) this._scheduleRecovery('Hänger', true);
            }, timeout * 1000);
        });
        wc.on('responsive', () => {
            if (this.timers.unresponsive) {
                clearTimeout(this.timers.unresponsive);
                delete this.timers.unresponsive;
                this.log('info', 'Seite reagiert wieder.');
            }
        });
    }

    _load(url) {
        const wc = this.webContents;
        if (!wc) return;
        this.state.lastActivity = Date.now();
        this.state.status = 'loading';
        this.state.error = '';
        // Failures are reported through did-fail-load; swallow the promise rejection.
        wc.loadURL(url).catch(() => {});
    }

    /** Exponential back-off: delay, 2×, 4×, … 32×. Counter resets after 5 min without failure. */
    _scheduleRecovery(reason, force = false) {
        if (!force && !this.settings.CRASH_RESTART) return;
        if (!this.running) return;
        const now = Date.now();
        if (now - this.lastFailureAt > FAILURE_RESET_MS) this.failures = 0;
        this.lastFailureAt = now;
        const delay = this.settings.CRASH_RESTART_DELAY * 1000 * Math.min(32, 2 ** this.failures);
        this.failures++;
        clearTimeout(this.timers.recovery);
        this.state.recoveryAt = now + delay;
        this.log('warn', `${reason}: neuer Versuch in ${Math.round(delay / 1000)} s (Versuch ${this.failures}).`);
        this.timers.recovery = setTimeout(() => {
            delete this.timers.recovery;
            this.state.recoveryAt = 0;
            if (!this.running || !this.cfg) return;
            this.state.reloads++;
            this._load(this.cfg.url);
            this.changed();
        }, delay);
    }

    _restartTimers() {
        clearInterval(this.timers.reload);
        clearInterval(this.timers.stall);
        delete this.timers.reload;
        delete this.timers.stall;
        if (!this.running) return;
        const s = this.settings;
        if (s.RELOAD_TIMER > 0) {
            this.timers.reload = setInterval(() => this.reload(`Reload-Intervall ${s.RELOAD_TIMER} s`), s.RELOAD_TIMER * 1000);
        }
        if (s.STALL_TIMEOUT > 0) {
            this.timers.stall = setInterval(() => {
                const limit = this.settings.STALL_TIMEOUT * 1000;
                if (limit > 0 && this.state.status === 'running' && Date.now() - this.state.lastActivity > limit) {
                    this.reload(`Stillstand seit ${this.settings.STALL_TIMEOUT} s`);
                }
            }, STALL_CHECK_MS);
        }
    }

    // ---- actions --------------------------------------------------------------------------

    reload(reason) {
        const wc = this.webContents;
        if (!wc) return;
        this.state.reloads++;
        this.state.lastActivity = Date.now();
        this.log('info', reason ? `Neu laden (${reason})` : 'Neu laden');
        const url = wc.getURL();
        if (!url || url.startsWith('chrome-error:') || this.state.status === 'crashed' || this.state.status === 'error') {
            this._load(this.cfg.url);
        } else {
            this.state.status = 'loading';
            wc.reload();
        }
        this.changed();
    }

    home() {
        if (this.webContents && this.cfg) this._load(this.cfg.url);
    }

    back() {
        const wc = this.webContents;
        if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    }

    show() {
        if (!this.running) {
            this.start();
            if (!this.running) return;
        }
        if (this.win.isMinimized()) this.win.restore();
        this.win.show();
        this.win.focus();
    }

    hide() {
        if (this.running) this.win.hide();
    }

    setMuted(muted) {
        this.state.muted = Boolean(muted);
        if (this.webContents) this.webContents.setAudioMuted(this.state.muted);
        for (const popup of this.popups) {
            if (!popup.isDestroyed()) popup.webContents.setAudioMuted(this.state.muted);
        }
        this.changed();
    }

    toggleMute() {
        this.setMuted(!this.state.muted);
    }

    zoom(direction) {
        const cfg = this.cfg;
        if (!cfg) return;
        const cur = cfg.zoom;
        let next = 1;
        if (direction > 0) next = ZOOM_STEPS.find(z => z > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
        else if (direction < 0) next = [...ZOOM_STEPS].reverse().find(z => z < cur - 0.001) ?? ZOOM_STEPS[0];
        this.manager.store.updateSurfer(this.id, {zoom: next});
        if (this.webContents) this.webContents.setZoomFactor(next);
        this.changed();
    }

    // ---- popups ---------------------------------------------------------------------------

    addPopup(win) {
        this.popups.add(win);
        win.setMenuBarVisibility(false);
        win.webContents.setAudioMuted(this.state.muted);
        this.manager.attachContents(this, win.webContents);
        win.on('closed', () => {
            this.popups.delete(win);
            this.changed();
        });
        this.log('info', `Popup geöffnet (${this.popups.size}/${this.settings.MAX_POPUPS})`);
        this.changed();
    }

    // ---- settings -------------------------------------------------------------------------

    /** Applies changed global settings to a running surfer. */
    applySettings(keys) {
        if (!this.running) return;
        const s = this.settings;
        const has = k => keys.includes(k);
        if (has('SHOW_TOOLBAR')) {
            if (s.SHOW_TOOLBAR) this._createToolbar();
            else this._removeToolbar();
            this._layout();
        }
        if (has('SHOW_IN_TASKBAR')) {
            this.win.setSkipTaskbar(!s.SHOW_IN_TASKBAR);
            for (const p of this.popups) if (!p.isDestroyed()) p.setSkipTaskbar(!s.SHOW_IN_TASKBAR);
        }
        if (has('MUTE_AUDIO')) this.setMuted(s.MUTE_AUDIO);
        if (has('BACKGROUND_THROTTLING')) {
            if (this.webContents) this.webContents.setBackgroundThrottling(s.BACKGROUND_THROTTLING);
            for (const p of this.popups) if (!p.isDestroyed()) p.webContents.setBackgroundThrottling(s.BACKGROUND_THROTTLING);
        }
        if (has('RELOAD_TIMER') || has('STALL_TIMEOUT')) this._restartTimers();
        if (has('MAX_POPUPS')) {
            const excess = [...this.popups].slice(s.MAX_POPUPS);
            for (const p of excess) if (!p.isDestroyed()) p.close();
        }
    }

    /** Applies a changed surfer configuration. */
    applyConfig(changedKeys) {
        if (!this.running) return;
        const cfg = this.cfg;
        if (changedKeys.includes('isolated')) {
            this.restart();
            return;
        }
        if (changedKeys.includes('name')) {
            this.win.setTitle(this.state.title ? `${cfg.name} · ${this.state.title}` : cfg.name);
        }
        if (changedKeys.includes('url')) this._load(cfg.url);
        if (changedKeys.includes('zoom') && this.webContents) this.webContents.setZoomFactor(cfg.zoom);
        this.changed();
    }

    // ---- state ----------------------------------------------------------------------------

    countBlocked() {
        this.state.blocked++;
        this.changed();
    }

    changed() {
        this.manager.surferChanged(this);
        this._pushToolbarSoon();
    }

    _pushToolbarSoon() {
        if (!this.toolbar || this.timers.toolbar) return;
        this.timers.toolbar = setTimeout(() => {
            delete this.timers.toolbar;
            this.pushToolbar();
        }, 150);
    }

    pushToolbar() {
        if (!this.toolbar || this.toolbar.webContents.isDestroyed()) return;
        const wc = this.webContents;
        this.toolbar.webContents.send('toolbar:state', {
            name: this.name,
            status: this.state.status,
            loading: this.state.loading,
            url: this.state.currentUrl || (this.cfg ? this.cfg.url : ''),
            title: this.state.title,
            muted: this.state.muted,
            zoom: this.cfg ? this.cfg.zoom : 1,
            canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
            blocked: this.state.blocked,
            popups: this.popups.size,
            error: this.state.error
        });
    }

    snapshot() {
        const cfg = this.cfg || {};
        return {
            id: this.id,
            name: cfg.name,
            url: cfg.url,
            autostart: cfg.autostart,
            isolated: cfg.isolated,
            zoom: cfg.zoom,
            host: displayHost(this.state.currentUrl || cfg.url || ''),
            running: this.running,
            popups: this.popups.size,
            ...this.state
        };
    }
}

module.exports = {Surfer, contentPreferences, uiPreferences, lockDown};
