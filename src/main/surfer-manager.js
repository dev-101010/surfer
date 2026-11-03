'use strict';

const {app, session, screen} = require('electron');
const {EventEmitter} = require('events');
const {Surfer, contentPreferences} = require('./surfer');
const {RequestFilter} = require('./filter');
const {createCpuSampler, memoryUsage} = require('./system-stats');

const METRICS_INTERVAL_MS = 2000;
const HISTORY_LENGTH = 150; // 5 minutes at 2 s
const BLOCK_LOG_BURST = 30; // max block log lines per second
const WARN_REPEAT_MS = 60 * 1000;
const SHARED_PARTITION = 'persist:surfer';

function frameDepth(frame) {
    // Number of ancestors of the frame: top document = 0, iframe in top document = 1, ...
    let depth = 0;
    try {
        let f = frame;
        while (f && f.parent) {
            depth++;
            f = f.parent;
        }
    } catch { /* frame destroyed meanwhile */ }
    return depth;
}

function headerValue(headers, name) {
    if (!headers) return '';
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === name) return Array.isArray(v) ? String(v[0] || '') : String(v || '');
    }
    return '';
}

/**
 * Owns all surfers, their sessions and the request filter. Emits:
 *  'surfers' (snapshots[])  – throttled
 *  'stats'   (stats)        – every 2 s
 */
class SurferManager extends EventEmitter {
    constructor({store, logger}) {
        super();
        this.store = store;
        this.logger = logger;
        this.filter = new RequestFilter();
        this.surfers = new Map();
        this.contents = new Map(); // webContents.id -> Surfer (main view + popups)
        this.toolbars = new Map(); // webContents.id -> Surfer
        this.sessions = new Set();
        this.totalBlocked = 0;
        this.history = [];
        this.lastStats = null;
        this.cpuSampler = createCpuSampler();
        this.overloadSampler = createCpuSampler();
        this.overloadCount = 0;
        this.lastOverloadWarn = 0;
        this.blockLog = {windowStart: 0, count: 0, suppressed: 0};
        this.timers = {};
        this.quitting = false;
    }

    init() {
        this.refreshFilter();
        this.syncSurfers();
        this.store.on('change', change => this._onConfigChange(change));
        this.timers.metrics = setInterval(() => this._collectMetrics(), METRICS_INTERVAL_MS);
        this._restartOverloadTimer();
    }

    refreshFilter() {
        this.filter.update(this.store.data.settings, this.store.data.lists);
    }

    /** Ensures there is exactly one Surfer runtime object per configured surfer. */
    syncSurfers() {
        const ids = new Set(this.store.data.surfers.map(s => s.id));
        for (const [id, surfer] of this.surfers) {
            if (!ids.has(id)) {
                surfer.stop('entfernt');
                this.surfers.delete(id);
            }
        }
        for (const id of ids) if (!this.surfers.has(id)) this.surfers.set(id, new Surfer(this, id));
    }

    ordered() {
        return this.store.data.surfers.map(c => this.surfers.get(c.id)).filter(Boolean);
    }

    get(id) {
        return this.surfers.get(id) || null;
    }

    // ---- config changes -------------------------------------------------------------------

    _onConfigChange({section, keys, fields}) {
        if (section === 'settings' || section === 'lists') this.refreshFilter();
        if (section === 'settings') {
            for (const surfer of this.surfers.values()) surfer.applySettings(keys);
            if (keys.includes('CUSTOM_USER_AGENT')) this._applyUserAgent();
            if (keys.includes('BLOCK_OTHER_URL_TYPES')) {
                for (const wc of this._allContents()) this._applyWebRtcPolicy(wc);
            }
            if (keys.some(k => k.startsWith('OVERLOAD_'))) this._restartOverloadTimer();
        }
        if (section === 'userAgent') this._applyUserAgent();
        if (section === 'surfers') {
            this.syncSurfers();
            if (fields) {
                for (const id of keys) {
                    const surfer = this.surfers.get(id);
                    if (surfer) surfer.applyConfig(fields);
                }
            }
            this.emitSurfersSoon();
        }
    }

    // ---- sessions & request filtering -----------------------------------------------------

    partitionFor(cfg) {
        return cfg.isolated ? `persist:surfer-${cfg.id}` : SHARED_PARTITION;
    }

    sessionFor(cfg) {
        const ses = session.fromPartition(this.partitionFor(cfg));
        this._setupSession(ses);
        return ses;
    }

    _userAgent() {
        const {settings, userAgent} = this.store.data;
        return settings.CUSTOM_USER_AGENT && userAgent ? userAgent : app.userAgentFallback;
    }

    _applyUserAgent() {
        const ua = this._userAgent();
        for (const ses of this.sessions) ses.setUserAgent(ua);
        this.logger.info('Surfer', `User-Agent: ${ua}`);
    }

    _setupSession(ses) {
        if (this.sessions.has(ses)) return;
        this.sessions.add(ses);

        ses.setUserAgent(this._userAgent());
        ses.setSpellCheckerEnabled(false);
        ses.setPermissionRequestHandler((wc, permission, callback) => {
            const surfer = wc && this.contents.get(wc.id);
            this.logger.debug(surfer ? surfer.name : 'Surfer', `Berechtigung verweigert: ${permission}`);
            callback(false);
        });
        ses.setPermissionCheckHandler(() => false);
        ses.setDevicePermissionHandler(() => false);

        ses.webRequest.onBeforeRequest((details, callback) => {
            let verdict;
            try {
                verdict = this.filter.checkRequest({
                    url: details.url,
                    resourceType: details.resourceType,
                    // for sub frame navigations `frame` is the sub frame itself
                    frameDepth: details.resourceType === 'subFrame' ? frameDepth(details.frame) : 0
                });
            } catch (err) {
                this.logger.error('Filter', `Fehler bei ${details.url}: ${err.message}`);
                verdict = {block: false};
            }
            if (verdict.block) {
                this._onBlocked(details, verdict.reason);
                callback({cancel: true});
            } else {
                callback({});
            }
        });

        ses.webRequest.onHeadersReceived((details, callback) => {
            let verdict;
            try {
                verdict = this.filter.checkResponse({
                    url: details.url,
                    resourceType: details.resourceType,
                    contentType: headerValue(details.responseHeaders, 'content-type')
                });
            } catch {
                verdict = {block: false};
            }
            if (verdict.block) {
                this._onBlocked(details, verdict.reason);
                callback({cancel: true});
            } else {
                callback({});
            }
        });

        ses.on('will-download', (event, item, wc) => {
            if (!this.store.data.settings.BLOCK_DOWNLOADS) return;
            event.preventDefault();
            const surfer = wc && this.contents.get(wc.id);
            this.totalBlocked++;
            if (surfer) surfer.countBlocked();
            this.logger.block(surfer ? surfer.name : 'Surfer', `Download blockiert: ${item.getURL()}`);
        });
    }

    _onBlocked(details, reason) {
        this.totalBlocked++;
        const surfer = details.webContentsId !== undefined ? this.contents.get(details.webContentsId) : null;
        if (surfer) surfer.countBlocked();
        if (!this.store.data.settings.LOG_BLOCKED) return;

        // Rate limit: a misbehaving page can fire thousands of blocked requests per second.
        const now = Date.now();
        const bl = this.blockLog;
        if (now - bl.windowStart > 1000) {
            if (bl.suppressed > 0) this.logger.block('Filter', `… ${bl.suppressed} weitere Blockierungen nicht einzeln protokolliert`);
            bl.windowStart = now;
            bl.count = 0;
            bl.suppressed = 0;
        }
        if (bl.count >= BLOCK_LOG_BURST) {
            bl.suppressed++;
            return;
        }
        bl.count++;
        this.logger.block(surfer ? surfer.name : 'Surfer', `${reason}: ${details.url.slice(0, 300)}`);
    }

    // ---- per webContents hardening --------------------------------------------------------

    /** Wires a content webContents (main view or popup) to its surfer. */
    attachContents(surfer, wc) {
        this.contents.set(wc.id, surfer);
        wc.once('destroyed', () => this.contents.delete(wc.id));
        wc.setAudioMuted(surfer.state.muted);
        wc.setBackgroundThrottling(this.store.data.settings.BACKGROUND_THROTTLING);
        this._applyWebRtcPolicy(wc);

        // beforeunload handlers must never block reloads or closing
        wc.on('will-prevent-unload', e => e.preventDefault());

        wc.on('will-navigate', (event, legacyUrl) => {
            const url = event.url || legacyUrl;
            const verdict = this.filter.checkNavigation(wc.getURL(), url);
            if (verdict.block) {
                event.preventDefault();
                this._onBlocked({webContentsId: wc.id, url}, verdict.reason);
            }
        });

        wc.setWindowOpenHandler(details => {
            const source = (details.referrer && details.referrer.url) || wc.getURL();
            const verdict = this.filter.checkPopup(source, details.url);
            if (verdict.block) {
                this._onBlocked({webContentsId: wc.id, url: details.url}, verdict.reason);
                return {action: 'deny'};
            }
            const s = this.store.data.settings;
            if (surfer.popups.size >= s.MAX_POPUPS) {
                this._onBlocked({webContentsId: wc.id, url: details.url}, `Popup-Limit (${s.MAX_POPUPS}) erreicht`);
                return {action: 'deny'};
            }
            return {
                action: 'allow',
                outlivesOpener: false,
                overrideBrowserWindowOptions: {
                    width: Math.min(s.WINDOW_WIDTH, 1280),
                    height: Math.min(s.WINDOW_HEIGHT, 900),
                    show: surfer.state.visible,
                    skipTaskbar: !s.SHOW_IN_TASKBAR,
                    autoHideMenuBar: true,
                    backgroundColor: '#ffffff',
                    webPreferences: contentPreferences(s)
                }
            };
        });

        wc.on('did-create-window', win => surfer.addPopup(win));
    }

    _applyWebRtcPolicy(wc) {
        if (wc.isDestroyed()) return;
        wc.setWebRTCIPHandlingPolicy(this.store.data.settings.BLOCK_OTHER_URL_TYPES ? 'disable_non_proxied_udp' : 'default');
    }

    _allContents() {
        const out = [];
        for (const surfer of this.surfers.values()) {
            if (surfer.webContents) out.push(surfer.webContents);
            for (const p of surfer.popups) if (!p.isDestroyed()) out.push(p.webContents);
        }
        return out;
    }

    registerToolbar(surfer, wc) {
        this.toolbars.set(wc.id, surfer);
        wc.once('destroyed', () => this.toolbars.delete(wc.id));
    }

    toolbarOwner(wc) {
        return this.toolbars.get(wc.id) || null;
    }

    /** Flags for the content preload (requested synchronously from every frame). */
    pageConfig() {
        const s = this.store.data.settings;
        return {
            fakeVisible: s.JS_FAKE_VISIBLE_ENABLED,
            mouseSimulation: s.JS_MOUSE_SIMULATION,
            domGuard: s.JS_CHECK_ENABLED
        };
    }

    // ---- bulk actions ---------------------------------------------------------------------

    startAutostart() {
        const list = this.ordered().filter(s => s.cfg.autostart);
        list.forEach((surfer, i) => setTimeout(() => !this.quitting && surfer.start(), i * 400));
        if (!this.store.data.surfers.length) {
            this.logger.info('Surfer', 'Noch keine Surfer eingerichtet – füge im Hauptfenster deinen ersten Surfbar-Link hinzu.');
        }
    }

    startAll() {
        this.ordered().forEach((surfer, i) => setTimeout(() => !this.quitting && surfer.start(), i * 400));
    }

    stopAll(reason = 'Alle stoppen') {
        for (const surfer of this.surfers.values()) surfer.stop(reason);
    }

    reloadAll(reason = 'Alle neu laden') {
        for (const surfer of this.surfers.values()) surfer.reload(reason);
    }

    showAll() {
        for (const surfer of this.ordered()) if (surfer.running) surfer.win.showInactive();
    }

    hideAll() {
        for (const surfer of this.surfers.values()) surfer.hide();
    }

    /** Arranges all running surfers in a grid on the display of the first one. */
    tile() {
        const list = this.ordered().filter(s => s.running);
        if (!list.length) return 0;
        const display = screen.getDisplayMatching(list[0].win.getBounds());
        const wa = display.workArea;
        const safeCols = Math.max(1, Math.ceil(Math.sqrt(list.length)));
        const rows = Math.ceil(list.length / safeCols);
        const w = Math.floor(wa.width / safeCols);
        const h = Math.floor(wa.height / rows);
        list.forEach((surfer, i) => {
            if (surfer.win.isMinimized()) surfer.win.restore();
            if (surfer.win.isMaximized()) surfer.win.unmaximize();
            surfer.win.setBounds({x: wa.x + (i % safeCols) * w, y: wa.y + Math.floor(i / safeCols) * h, width: w, height: h});
            surfer.win.showInactive();
        });
        return list.length;
    }

    isOnScreen(bounds) {
        return screen.getAllDisplays().some(d => {
            const a = d.workArea;
            const ix = Math.min(a.x + a.width, bounds.x + bounds.width) - Math.max(a.x, bounds.x);
            const iy = Math.min(a.y + a.height, bounds.y + bounds.height) - Math.max(a.y, bounds.y);
            return ix >= 100 && iy >= 50;
        });
    }

    async clearSessionData(id) {
        const cfg = id ? this.store.getSurfer(id) : null;
        const ses = session.fromPartition(cfg ? this.partitionFor(cfg) : SHARED_PARTITION);
        await ses.clearStorageData();
        await ses.clearCache();
        this.logger.info('Surfer', `Cookies und Cache gelöscht (${cfg ? cfg.name : 'gemeinsame Session'}).`);
    }

    async removeSurfer(id) {
        const surfer = this.surfers.get(id);
        const cfg = this.store.getSurfer(id);
        if (!cfg) return {ok: false, errors: ['Surfer nicht gefunden']};
        if (surfer && surfer.running) {
            const closed = new Promise(resolve => surfer.win.once('closed', resolve));
            surfer.stop('entfernt');
            await closed;
        }
        if (cfg.isolated) {
            try {
                await session.fromPartition(this.partitionFor(cfg)).clearStorageData();
            } catch { /* ignore */ }
        }
        return this.store.removeSurfer(id);
    }

    shutdown() {
        this.quitting = true;
        for (const t of Object.values(this.timers)) clearInterval(t);
        this.stopAll('Programmende');
    }

    // ---- change propagation ---------------------------------------------------------------

    surferChanged() {
        this.emitSurfersSoon();
    }

    emitSurfersSoon() {
        if (this.timers.emit) return;
        this.timers.emit = setTimeout(() => {
            delete this.timers.emit;
            this.emit('surfers', this.snapshots());
        }, 250);
    }

    snapshots() {
        return this.ordered().map(s => s.snapshot());
    }

    // ---- metrics & overload ---------------------------------------------------------------

    _collectMetrics() {
        let metrics = [];
        try {
            metrics = app.getAppMetrics();
        } catch { /* ignore */ }
        const byPid = new Map(metrics.map(m => [m.pid, m]));
        const s = this.store.data.settings;

        for (const surfer of this.surfers.values()) {
            const wc = surfer.webContents;
            if (!wc) continue;
            let pid = 0;
            try {
                pid = wc.getOSProcessId();
            } catch { /* ignore */ }
            const m = byPid.get(pid);
            surfer.state.pid = pid;
            surfer.state.cpu = m ? Math.round(m.cpu.percentCPUUsage * 10) / 10 : 0;
            surfer.state.memoryMB = m ? Math.round(m.memory.workingSetSize / 1024) : 0;

            if (s.RENDERER_OVERLOAD_CHECK && m && surfer.state.status === 'running') {
                if (m.cpu.percentCPUUsage > s.RENDERER_CPU_THRESHOLD) {
                    surfer.overloadCount++;
                    if (surfer.overloadCount >= s.RENDERER_EXCEED_LIMIT) {
                        surfer.overloadCount = 0;
                        surfer.reload(`Renderer-CPU ${Math.round(m.cpu.percentCPUUsage)} % > ${s.RENDERER_CPU_THRESHOLD} %`);
                    }
                } else {
                    surfer.overloadCount = 0;
                }
            }
        }

        const cpu = this.cpuSampler();
        const mem = memoryUsage();
        this.history.push({t: Date.now(), cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem.percent * 10) / 10});
        if (this.history.length > HISTORY_LENGTH) this.history.shift();

        const appMemoryMB = Math.round(metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
        const appCpu = Math.round(metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0) * 10) / 10;
        const owners = new Map();
        for (const surfer of this.surfers.values()) if (surfer.state.pid) owners.set(surfer.state.pid, surfer.name);

        this.lastStats = {
            cpu: Math.round(cpu * 10) / 10,
            memory: mem,
            appCpu,
            appMemoryMB,
            totalBlocked: this.totalBlocked,
            overload: {enabled: s.OVERLOAD_ENABLED, count: this.overloadCount, limit: s.OVERLOAD_EXCEED_LIMIT},
            processes: metrics.map(m => ({
                pid: m.pid,
                type: m.type,
                name: m.name || m.serviceName || '',
                owner: owners.get(m.pid) || '',
                cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
                memoryMB: Math.round(m.memory.workingSetSize / 1024)
            })).sort((a, b) => b.memoryMB - a.memoryMB),
            history: this.history
        };
        this.emit('stats', this.lastStats);
        this.emitSurfersSoon();
    }

    _restartOverloadTimer() {
        clearInterval(this.timers.overload);
        delete this.timers.overload;
        this.overloadCount = 0;
        const s = this.store.data.settings;
        if (!s.OVERLOAD_ENABLED) return;
        this.overloadSampler();
        this.timers.overload = setInterval(() => this._checkOverload(), s.OVERLOAD_CHECK_INTERVAL * 1000);
    }

    _checkOverload() {
        const s = this.store.data.settings;
        const cpu = this.overloadSampler();
        const ram = memoryUsage().percent;
        const fmt = `CPU ${cpu.toFixed(1)} % | RAM ${ram.toFixed(1)} %`;
        const now = Date.now();

        if ((cpu > s.OVERLOAD_WARNING_CPU || ram > s.OVERLOAD_WARNING_RAM) && now - this.lastOverloadWarn > WARN_REPEAT_MS) {
            this.lastOverloadWarn = now;
            this.logger.warn('System', `Hohe Auslastung: ${fmt}`);
        }

        if (cpu > s.OVERLOAD_THRESHOLD_CPU || ram > s.OVERLOAD_THRESHOLD_RAM) {
            this.overloadCount++;
            this.logger.warn('System', `Überlast ${this.overloadCount}/${s.OVERLOAD_EXCEED_LIMIT}: ${fmt}`);
            if (this.overloadCount >= s.OVERLOAD_EXCEED_LIMIT) {
                this.overloadCount = 0;
                this.logger.error('System', 'Überlastgrenze erreicht – alle Surfer werden neu geladen.');
                this.reloadAll('System-Überlast');
            }
        } else {
            this.overloadCount = 0;
        }
    }
}

module.exports = {SurferManager, frameDepth, SHARED_PARTITION};
