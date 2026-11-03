'use strict';

/* Preload for the toolbar shown above each surfer page. */

const {contextBridge, ipcRenderer} = require('electron');

const ACTIONS = new Set(['back', 'reload', 'home', 'zoom-in', 'zoom-out', 'zoom-reset', 'mute', 'hide', 'control']);

contextBridge.exposeInMainWorld('surferToolbar', {
    action(name) {
        if (ACTIONS.has(name)) ipcRenderer.send('toolbar:action', name);
    },
    onStrings(callback) {
        if (typeof callback === 'function') ipcRenderer.on('toolbar:i18n', (_e, i18n) => callback(i18n));
    },
    onState(callback) {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('toolbar:state', (_e, state) => callback(state));
        ipcRenderer.send('toolbar:ready');
    }
});
