'use strict';

const path = require('path');
const fs = require('fs');
const {app, Menu, net, dialog} = require('electron');
const {Logger} = require('./logger');
const {ConfigStore} = require('./config-store');
const {SurferManager} = require('./surfer-manager');
const {ControlCenter} = require('./control');
const {Updater} = require('./updater');

const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const APP_ROOT = path.join(__dirname, '..', '..');
const CONFIG_DIR = process.env.SURFER_CONFIG_DIR ? path.resolve(process.env.SURFER_CONFIG_DIR) : path.join(APP_ROOT, 'config');
const LOG_DIR = path.join(path.dirname(CONFIG_DIR), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'surfer.log');

if (process.env.SURFER_CONFIG_DIR) {
    // Separate config => separate browser profile, so test/second setups never share cookies.
    app.setPath('userData', path.join(path.dirname(CONFIG_DIR), 'userdata'));
}

const logger = new Logger();

// Electron reports e.g. every blocked sub frame as a process warning – keep the console clean.
process.emitWarning = (warning, ...rest) => {
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] && rest[0].type) || 'Warning';
    logger.debug('System', `${type}: ${warning instanceof Error ? warning.message : warning}`);
};

process.on('uncaughtException', err => logger.error('System', `Unbehandelter Fehler: ${err && err.stack ? err.stack : err}`));
process.on('unhandledRejection', reason => logger.error('System', `Unbehandelte Promise-Ablehnung: ${reason && reason.stack ? reason.stack : reason}`));

/**
 * Surfer normally runs without a console window, so a failed start must be visible:
 * write it to logs/startup-error.log and show a native error box.
 */
function fatal(err) {
    const text = err && err.stack ? err.stack : String(err);
    logger.error('System', `Start fehlgeschlagen: ${text}`);
    let file = '';
    try {
        fs.mkdirSync(LOG_DIR, {recursive: true});
        file = path.join(LOG_DIR, 'startup-error.log');
        fs.writeFileSync(file, `${new Date().toISOString()}\n${text}\n`, 'utf-8');
    } catch {
        file = '';
    }
    try {
        dialog.showErrorBox('Surfer konnte nicht gestartet werden',
            `${err && err.message ? err.message : text}\n\n${file ? `Details: ${file}\n` : ''}Zur Fehlersuche mit start-debug.bat bzw. ./start.sh --debug starten.`);
    } catch { /* ignore */ }
    app.exit(1);
}

if (!app.requestSingleInstanceLock()) {
    // Another instance owns this profile – it will bring its window to front.
    process.stdout.write('Surfer läuft bereits.\n');
    app.quit();
} else {
    try {
        boot();
    } catch (err) {
        fatal(err);
    }
}

function applyLoggerSettings(settings) {
    logger.setConsole(settings.LOG_TO_CONSOLE);
    logger.setFile(settings.LOG_TO_FILE ? LOG_FILE : null);
}

function applyBrowserSwitches(b) {
    app.commandLine.appendSwitch('disable-logging');
    const switches = {
        disableSiteIsolationTrials: 'disable-site-isolation-trials',
        disableGpuProcessPrelaunch: 'disable-gpu-process-prelaunch',
        disableRendererBackgrounding: 'disable-renderer-backgrounding',
        enableLowEndDeviceMode: 'enable-low-end-device-mode',
        disableAccelerated2DCanvas: 'disable-accelerated-2d-canvas',
        disableSoftwareRasterizer: 'disable-software-rasterizer',
        disableGpu: 'disable-gpu',
        disableGpuCompositing: 'disable-gpu-compositing'
    };
    for (const [key, sw] of Object.entries(switches)) if (b[key]) app.commandLine.appendSwitch(sw);
    if (b.disableHardwareAcceleration) app.disableHardwareAcceleration();
    if (b.rendererProcessLimit > 0) app.commandLine.appendSwitch('renderer-process-limit', String(b.rendererProcessLimit));
}

/** Removes the "Electron/x" and app tokens so pages see a plain Chrome user agent. */
function sanitizeDefaultUserAgent() {
    const name = app.getName().replace(/[^A-Za-z0-9]/g, '');
    const re = new RegExp(`\\s(?:Electron|${name})/\\S+`, 'gi');
    app.userAgentFallback = app.userAgentFallback.replace(re, '');
}

function buildMenu() {
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
        return;
    }
    // macOS needs an application menu for copy/paste and Cmd+Q.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {role: 'appMenu'},
        {role: 'editMenu'},
        {role: 'windowMenu'}
    ]));
}

function boot() {
    const store = new ConfigStore(CONFIG_DIR, {log: (level, msg) => logger.log(level, 'Konfiguration', msg)});
    store.load();
    applyLoggerSettings(store.data.settings);
    store.on('change', ({section, keys}) => {
        if (section === 'settings' && keys.some(k => k.startsWith('LOG_TO_'))) applyLoggerSettings(store.data.settings);
    });

    const startupBrowser = {...store.data.browser};
    applyBrowserSwitches(startupBrowser);

    const manager = new SurferManager({store, logger});
    const updater = new Updater({appRoot: APP_ROOT, logger, isPackaged: app.isPackaged, fetchImpl: (url, opts) => net.fetch(url, opts)});
    const control = new ControlCenter({
        store,
        logger,
        manager,
        updater,
        startupBrowser,
        paths: {config: CONFIG_DIR, logs: LOG_DIR, userData: app.getPath('userData')}
    });

    app.on('second-instance', () => control.open());

    app.on('web-contents-created', (_e, contents) => {
        // No page may ever embed <webview> (would bypass all webPreferences).
        contents.on('will-attach-webview', e => e.preventDefault());
    });

    app.whenReady().then(() => {
        sanitizeDefaultUserAgent();
        buildMenu();
        logger.info('Surfer', `Surfer ${app.getVersion()} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome}`);
        logger.info('Surfer', `Konfiguration: ${store.file}`);
        manager.init();
        control.init();
        control.open();
        if (store.data.settings.AUTOSTART) manager.startAutostart();
        const autoCheck = () => {
            if (store.data.settings.UPDATE_CHECK) updater.check().catch(() => {});
        };
        setTimeout(autoCheck, 8000);
        setInterval(autoCheck, UPDATE_INTERVAL_MS);
    }).catch(fatal);

    app.on('activate', () => control.open());

    app.on('window-all-closed', () => app.quit());

    app.on('before-quit', () => {
        control.allowClose = true;
        manager.shutdown();
        store.saveNow();
    });

    app.on('will-quit', () => {
        logger.info('Surfer', 'Programm beendet.');
        logger.close();
    });
}
