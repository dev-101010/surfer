'use strict';

/*
 * Preload for surfer page content (sandboxed, runs in every frame before page scripts).
 * Nothing is exposed to the page. The isolated world only reads a few flags from the
 * main process and injects the visibility patch into the page's main world.
 */

const {contextBridge, ipcRenderer} = require('electron');

/* This function is serialized and executed in the page's main world – no closures allowed. */
function mainWorldPatch(opts) {
    try {
        const setTimeoutRef = window.setTimeout.bind(window);

        if (opts.fakeVisible) {
            const define = function (proto, prop, value) {
                try {
                    Object.defineProperty(proto, prop, {
                        configurable: true,
                        enumerable: true,
                        get: function () {
                            return value;
                        }
                    });
                } catch (e) { /* ignore */ }
            };
            define(Document.prototype, 'hidden', false);
            define(Document.prototype, 'webkitHidden', false);
            define(Document.prototype, 'visibilityState', 'visible');
            define(Document.prototype, 'webkitVisibilityState', 'visible');
            try {
                Document.prototype.hasFocus = function hasFocus() {
                    return true;
                };
            } catch (e) { /* ignore */ }

            // Registered before any page script: swallow visibility/blur events of window and
            // document, including on*-property handlers. Element blur events are left alone.
            const swallow = function (event) {
                if (event.target === window || event.target === document) {
                    event.stopImmediatePropagation();
                }
            };
            ['visibilitychange', 'webkitvisibilitychange', 'blur', 'freeze'].forEach(function (type) {
                window.addEventListener(type, swallow, true);
            });
        }

        if (opts.domGuard) {
            try {
                const pause = HTMLMediaElement.prototype.pause;
                HTMLMediaElement.prototype.play = function play() {
                    try {
                        this.muted = true;
                        pause.call(this);
                    } catch (e) { /* ignore */ }
                    return Promise.resolve();
                };
            } catch (e) { /* ignore */ }
        }

        if (opts.mouseSimulation && window === window.top) {
            const tick = function () {
                try {
                    const x = Math.floor(Math.random() * Math.max(1, window.innerWidth));
                    const y = Math.floor(Math.random() * Math.max(1, window.innerHeight));
                    const target = (document.elementFromPoint && document.elementFromPoint(x, y)) || document;
                    target.dispatchEvent(new MouseEvent('mousemove', {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y,
                        screenX: window.screenX + x,
                        screenY: window.screenY + y
                    }));
                } catch (e) { /* ignore */ }
                setTimeoutRef(tick, 5000 + Math.random() * 10000);
            };
            setTimeoutRef(tick, 5000 + Math.random() * 10000);
        }
    } catch (e) { /* never break the page */ }
}

function startDomGuard() {
    const SELECTOR = 'video, audio, iframe[srcdoc]';
    const remove = function (el) {
        try {
            if (typeof el.pause === 'function') el.pause();
            if (el.tagName !== 'IFRAME') el.removeAttribute('src');
            el.remove();
        } catch { /* ignore */ }
    };
    const sweep = function (root) {
        if (root && root.querySelectorAll) root.querySelectorAll(SELECTOR).forEach(remove);
    };
    const observer = new MutationObserver(function (mutations) {
        for (const m of mutations) {
            if (m.type === 'attributes') {
                if (m.target.tagName === 'IFRAME' && m.target.hasAttribute('srcdoc')) remove(m.target);
                continue;
            }
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.matches(SELECTOR)) remove(node);
                else if (node.firstElementChild) sweep(node);
            }
        }
    });
    observer.observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['srcdoc']});
    sweep(document);
}

let cfg = null;
try {
    cfg = ipcRenderer.sendSync('surfer:page-config');
} catch {
    cfg = null;
}

if (cfg && typeof cfg === 'object') {
    const opts = {
        fakeVisible: cfg.fakeVisible === true,
        mouseSimulation: cfg.mouseSimulation === true,
        domGuard: cfg.domGuard === true
    };
    if (opts.fakeVisible || opts.mouseSimulation || opts.domGuard) {
        try {
            contextBridge.executeInMainWorld({func: mainWorldPatch, args: [opts]});
        } catch { /* ignore */ }
    }
    if (opts.domGuard) {
        try {
            startDomGuard();
        } catch { /* ignore */ }
    }
}
