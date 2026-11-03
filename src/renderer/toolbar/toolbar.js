'use strict';

const $ = id => document.getElementById(id);
let STRINGS = {};
let lastState = null;

function t(key, params) {
    const template = Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
}

document.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => window.surferToolbar.action(btn.dataset.action));
});

function renderUrl(el, state) {
    el.textContent = '';
    el.classList.toggle('error', Boolean(state.error) && (state.status === 'error' || state.status === 'crashed'));
    if (el.classList.contains('error')) {
        el.textContent = state.error;
        el.title = state.error;
        return;
    }
    let url;
    try {
        url = new URL(state.url);
    } catch {
        el.textContent = state.url || '';
        return;
    }
    const scheme = document.createElement('span');
    scheme.textContent = `${url.protocol}//`;
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = url.host;
    const rest = document.createElement('span');
    rest.textContent = `${url.pathname}${url.search}`;
    el.append(scheme, host, rest);
    el.title = state.title ? `${state.title}\n${state.url}` : state.url;
}

function render(state) {
    lastState = state;
    const status = state.loading && state.status === 'running' ? 'loading' : state.status;
    $('status').className = `status ${status}`;
    $('status').title = t(`ui.status.${status}`);
    $('name').textContent = state.name;
    $('back').disabled = !state.canGoBack;
    $('zoom').textContent = `${Math.round(state.zoom * 100)} %`;
    $('mute').classList.toggle('sound', !state.muted);
    $('mute').title = state.muted ? t('tb.unmute') : t('tb.mute');
    $('blocked').textContent = state.blocked > 0 ? t('tb.blocked', {n: state.blocked}) : '';
    renderUrl($('url'), state);
}

window.surferToolbar.onStrings(i18n => {
    STRINGS = i18n.strings || {};
    document.documentElement.lang = i18n.lang;
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    if (lastState) render(lastState);
});

window.surferToolbar.onState(render);
