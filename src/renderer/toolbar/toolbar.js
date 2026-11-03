'use strict';

const $ = id => document.getElementById(id);

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

window.surferToolbar.onState(state => {
    const status = state.loading && state.status === 'running' ? 'loading' : state.status;
    $('status').className = `status ${status}`;
    $('status').title = {running: 'Läuft', loading: 'Lädt …', error: 'Fehler', crashed: 'Abgestürzt', stopped: 'Gestoppt'}[status] || status;
    $('name').textContent = state.name;
    $('back').disabled = !state.canGoBack;
    $('zoom').textContent = `${Math.round(state.zoom * 100)} %`;
    $('mute').classList.toggle('sound', !state.muted);
    $('mute').title = state.muted ? 'Ton einschalten' : 'Stummschalten';
    $('blocked').textContent = state.blocked > 0 ? `${state.blocked} blockiert` : '';
    renderUrl($('url'), state);
});
