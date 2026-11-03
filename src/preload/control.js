'use strict';

/* Preload for the control window. Exposes a minimal, channel-restricted API. */

const {contextBridge, ipcRenderer} = require('electron');

const EVENTS = new Set(['surfers', 'stats', 'log', 'log-cleared', 'config', 'notice', 'update']);

contextBridge.exposeInMainWorld('surfer', {
    call(method, payload) {
        if (typeof method !== 'string') return Promise.reject(new Error('Ungültiger Aufruf'));
        return ipcRenderer.invoke('control:call', method, payload);
    },
    on(event, callback) {
        if (!EVENTS.has(event) || typeof callback !== 'function') return () => {};
        const listener = (_e, name, data) => {
            if (name === event) callback(data);
        };
        ipcRenderer.on('control:event', listener);
        return () => ipcRenderer.removeListener('control:event', listener);
    }
});
