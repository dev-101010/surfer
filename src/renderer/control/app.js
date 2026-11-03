'use strict';

/* Control window. All untrusted strings (page titles, URLs, log lines) go through textContent. */

const api = window.surfer;
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('de-DE');
const nf1 = new Intl.NumberFormat('de-DE', {minimumFractionDigits: 1, maximumFractionDigits: 1});

const state = {
    app: null,
    schema: null,
    defaults: null,
    settings: {},
    browser: {},
    lists: {},
    userAgent: '',
    restartRequired: false,
    surfers: [],
    stats: null,
    log: [],
    update: null,
    editing: new Set(),
    unreadErrors: 0,
    view: 'surfers'
};

// ---------- helpers ----------------------------------------------------------------------------

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k in el && typeof v !== 'string') el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

const ICONS = {
    play: ['M7 5l12 7-12 7z'],
    stop: ['M6 6h12v12H6z'],
    reload: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6'],
    eyeOff: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M4 4l16 16'],
    sound: ['M4 9h4l5-4v14l-5-4H4z', 'M17 8a5 5 0 0 1 0 8'],
    muted: ['M4 9h4l5-4v14l-5-4H4z', 'M17 9l4 6M21 9l-4 6'],
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
    up: ['M6 15l6-6 6 6'],
    down: ['M6 9l6 6 6-6'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    reset: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5']
};

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const d of ICONS[name] || []) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', d);
        svg.append(p);
    }
    return svg;
}

function toast(message, type = 'info', ms = 3500) {
    const el = h('div', {class: `toast ${type}`, text: message});
    $('toasts').append(el);
    setTimeout(() => el.remove(), ms);
}

async function call(method, payload, {quiet = false} = {}) {
    let res;
    try {
        res = await api.call(method, payload);
    } catch (err) {
        res = {ok: false, errors: [err.message]};
    }
    if (!res || !res.ok) {
        const msg = (res && res.errors && res.errors.join(' · ')) || 'Unbekannter Fehler';
        if (!quiet) toast(msg, 'error', 5000);
        return null;
    }
    return res.data === undefined ? true : res.data;
}

function confirmDialog(title, text, okLabel = 'OK') {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(resolve => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), {once: true}));
}

function fmtDuration(ms) {
    if (!ms || ms < 0) return '–';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const hh = Math.floor((s % 86400) / 3600);
    const mm = Math.floor((s % 3600) / 60);
    if (d) return `${d} T ${hh} h`;
    if (hh) return `${hh} h ${mm} min`;
    if (mm) return `${mm} min`;
    return `${s} s`;
}

function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('de-DE');
}

const STATUS_LABEL = {running: 'Läuft', loading: 'Lädt', error: 'Fehler', crashed: 'Abgestürzt', stopped: 'Gestoppt'};

// ---------- navigation --------------------------------------------------------------------------

function showView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'log') {
        state.unreadErrors = 0;
        $('nav-log').textContent = '';
        scrollLogToEnd();
    }
    if (view === 'system') {
        renderStats();
        drawChart();
    }
    renderUpdate();
    try {
        localStorage.setItem('surfer.view', view);
    } catch { /* ignore */ }
}

$('nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (btn) showView(btn.dataset.view);
});

document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-call]');
    if (!btn) return;
    const method = btn.dataset.call;
    if (method === 'stopAll' && !(await confirmDialog('Alle Surfer stoppen?', 'Alle laufenden Surfer-Fenster werden geschlossen.', 'Stoppen'))) return;
    if (method === 'restartApp' && !(await confirmDialog('Surfer neu starten?', 'Alle Surfer werden beendet und nach dem Neustart wieder automatisch gestartet (falls Autostart aktiv).', 'Neu starten'))) return;
    btn.disabled = true;
    const res = await call(method);
    btn.disabled = false;
    if (method === 'tile' && res === 0) toast('Keine laufenden Surfer zum Anordnen.', 'warn');
});

// ---------- surfers ------------------------------------------------------------------------------

const rows = new Map();

function metric(label, cls) {
    const value = h('div', {class: 'metric-value', text: '–'});
    return {el: h('div', {class: cls || ''}, h('div', {class: 'metric-label', text: label}), value), value};
}

function createRow(s) {
    const r = {};
    r.pill = h('span', {class: 'pill'});
    r.name = h('span', {class: 'surfer-name'});
    r.tags = h('span', {class: 'surfer-tags'});
    r.sub = h('div', {class: 'surfer-sub'});
    r.error = h('div', {class: 'surfer-error', hidden: true});

    r.m = {
        uptime: metric('Laufzeit'),
        reloads: metric('Reloads'),
        blocked: metric('Blockiert'),
        cpu: metric('CPU', 'm-optional'),
        mem: metric('RAM', 'm-optional')
    };

    const act = (iconName, title, onclick, cls = 'icon-btn') => {
        const b = h('button', {class: cls, title, onclick}, icon(iconName));
        return b;
    };
    r.btnPower = act('play', 'Starten', () => call(r.data.running ? 'stopSurfer' : 'startSurfer', s.id));
    r.btnReload = act('reload', 'Neu laden', () => call('reloadSurfer', s.id));
    r.btnShow = act('eye', 'Fenster anzeigen', () => call(r.data.visible ? 'hideSurfer' : 'showSurfer', s.id));
    r.btnMute = act('muted', 'Ton', () => call('muteSurfer', s.id));
    r.btnUp = act('up', 'Nach oben', () => call('moveSurfer', {id: s.id, direction: -1}));
    r.btnDown = act('down', 'Nach unten', () => call('moveSurfer', {id: s.id, direction: 1}));
    r.btnEdit = act('edit', 'Bearbeiten', () => toggleEdit(s.id));

    r.main = h('div', {class: 'surfer-main'},
        h('div', {class: 'surfer-id'},
            h('div', {class: 'surfer-title'}, r.pill, r.name, r.tags),
            r.sub,
            r.error
        ),
        h('div', {class: 'surfer-metrics'}, Object.values(r.m).map(m => m.el)),
        h('div', {class: 'surfer-actions'},
            r.btnPower, r.btnReload, r.btnShow, r.btnMute,
            h('span', {class: 'sep'}),
            r.btnUp, r.btnDown, r.btnEdit
        )
    );
    r.el = h('div', {class: 'surfer', dataset: {id: s.id}}, r.main);
    r.edit = null;
    rows.set(s.id, r);
    return r;
}

function updateRow(r, s) {
    r.data = s;
    const status = s.running && s.loading && s.status === 'running' ? 'loading' : s.status;
    r.el.className = `surfer status-${status}`;
    r.pill.className = `pill ${status}`;
    r.pill.textContent = s.recoveryAt ? `Neuer Versuch in ${fmtDuration(s.recoveryAt - Date.now())}` : (STATUS_LABEL[status] || status);
    r.name.textContent = s.name;
    r.name.title = s.name;

    r.tags.textContent = '';
    if (s.isolated) r.tags.append(h('span', {class: 'tag', text: 'Eigene Session'}));
    if (!s.autostart) r.tags.append(h('span', {class: 'tag', text: 'Kein Autostart'}));
    if (s.zoom !== 1) r.tags.append(h('span', {class: 'tag', text: `${Math.round(s.zoom * 100)} %`}));
    if (s.popups) r.tags.append(h('span', {class: 'tag', text: `${s.popups} Popup${s.popups > 1 ? 's' : ''}`}));
    if (s.running && !s.visible) r.tags.append(h('span', {class: 'tag', text: 'Verborgen'}));

    r.sub.textContent = '';
    r.sub.append(h('span', {class: 'host', text: s.host || s.url}));
    if (s.title) r.sub.append(` · ${s.title}`);
    r.sub.title = s.currentUrl || s.url;

    const showErr = Boolean(s.error) && (s.status === 'error' || s.status === 'crashed');
    r.error.hidden = !showErr;
    r.error.textContent = showErr ? s.error : '';

    r.m.uptime.value.textContent = s.running ? fmtDuration(Date.now() - s.startedAt) : '–';
    r.m.reloads.value.textContent = nf.format(s.reloads);
    r.m.blocked.value.textContent = nf.format(s.blocked);
    r.m.cpu.value.textContent = s.running ? `${nf1.format(s.cpu)} %` : '–';
    r.m.mem.value.textContent = s.running && s.memoryMB ? `${nf.format(s.memoryMB)} MB` : '–';

    r.btnPower.replaceChildren(icon(s.running ? 'stop' : 'play'));
    r.btnPower.title = s.running ? 'Stoppen' : 'Starten';
    r.btnPower.classList.toggle('on', !s.running);
    r.btnReload.disabled = !s.running;
    r.btnShow.replaceChildren(icon(s.running && s.visible ? 'eyeOff' : 'eye'));
    r.btnShow.title = s.running && s.visible ? 'Fenster verbergen (läuft weiter)' : 'Fenster anzeigen';
    r.btnMute.replaceChildren(icon(s.muted ? 'muted' : 'sound'));
    r.btnMute.title = s.muted ? 'Ton einschalten' : 'Stummschalten';
    r.btnMute.disabled = !s.running;

    const idx = state.surfers.findIndex(x => x.id === s.id);
    r.btnUp.disabled = idx <= 0;
    r.btnDown.disabled = idx >= state.surfers.length - 1;
}

function buildEdit(id) {
    const s = state.surfers.find(x => x.id === id);
    const name = h('input', {type: 'text', value: s.name, maxlength: '60'});
    const url = h('input', {type: 'text', value: s.url, maxlength: '2048', spellcheck: 'false'});
    const autostart = h('input', {type: 'checkbox', checked: s.autostart});
    const isolated = h('input', {type: 'checkbox', checked: s.isolated});
    const zoom = h('select', null, [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300].map(z =>
        h('option', {value: String(z / 100), text: `${z} %`, selected: Math.abs(s.zoom - z / 100) < 0.001})));

    const save = async () => {
        const res = await call('updateSurfer', {
            id,
            patch: {name: name.value, url: url.value, autostart: autostart.checked, isolated: isolated.checked, zoom: Number(zoom.value)}
        });
        if (res) {
            toast('Surfer gespeichert.', 'ok');
            toggleEdit(id, false);
        }
    };
    const remove = async () => {
        if (!(await confirmDialog(`„${s.name}“ entfernen?`, 'Der Surfer wird gestoppt und aus der Liste gelöscht. Bei eigener Session werden auch deren Cookies gelöscht.', 'Entfernen'))) return;
        state.editing.delete(id);
        if (await call('removeSurfer', id)) toast('Surfer entfernt.', 'ok');
    };
    const clearData = async () => {
        if (!(await confirmDialog('Cookies & Cache löschen?', s.isolated ? 'Die eigene Session dieses Surfers wird geleert (Logins gehen verloren).' : 'Dieser Surfer nutzt die gemeinsame Session – alle Surfer ohne eigene Session verlieren ihre Logins.', 'Löschen'))) return;
        if (await call('clearSurferData', id)) toast('Session geleert.', 'ok');
    };
    [name, url].forEach(inp => inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') toggleEdit(id, false);
    }));

    return h('div', {class: 'surfer-edit'},
        h('div', {class: 'field'}, h('label', {text: 'Name'}), name),
        h('div', {class: 'field'}, h('label', {text: 'Start-Adresse'}), url),
        h('div', {class: 'full opts'},
            h('label', {class: 'switch'}, autostart, h('span', {class: 'switch-track'}), h('span', {class: 'switch-label', text: 'Autostart'})),
            h('label', {class: 'switch', title: 'Eigene Cookies/Logins statt der gemeinsamen Session. Änderung startet den Surfer neu.'}, isolated, h('span', {class: 'switch-track'}), h('span', {class: 'switch-label', text: 'Eigene Session'})),
            h('label', {class: 'check'}, h('span', {text: 'Zoom'}), zoom)
        ),
        h('div', {class: 'full actions'},
            h('div', null,
                h('button', {class: 'btn btn-danger-ghost', onclick: remove}, icon('trash'), 'Entfernen'),
                h('button', {class: 'btn btn-ghost', onclick: clearData, text: 'Cookies & Cache löschen'})
            ),
            h('div', null,
                h('button', {class: 'btn btn-ghost', onclick: () => toggleEdit(id, false), text: 'Abbrechen'}),
                h('button', {class: 'btn btn-primary', onclick: save, text: 'Speichern'})
            )
        )
    );
}

function toggleEdit(id, force) {
    const r = rows.get(id);
    if (!r) return;
    const open = force === undefined ? !r.edit : force;
    if (open && !r.edit) {
        r.edit = buildEdit(id);
        r.el.append(r.edit);
        state.editing.add(id);
        r.edit.querySelector('input').focus();
    } else if (!open && r.edit) {
        r.edit.remove();
        r.edit = null;
        state.editing.delete(id);
    }
    r.btnEdit.classList.toggle('on', Boolean(r.edit));
}

function renderSurfers() {
    const list = $('surfer-list');
    const ids = new Set(state.surfers.map(s => s.id));
    for (const [id, r] of rows) {
        if (!ids.has(id)) {
            r.el.remove();
            rows.delete(id);
            state.editing.delete(id);
        }
    }
    state.surfers.forEach((s, i) => {
        const r = rows.get(s.id) || createRow(s);
        updateRow(r, s);
        if (list.children[i] !== r.el) list.insertBefore(r.el, list.children[i] || null);
    });

    const running = state.surfers.filter(s => s.running).length;
    const blocked = state.surfers.reduce((n, s) => n + s.blocked, 0);
    $('surfers-empty').hidden = state.surfers.length > 0;
    $('surfers-summary').textContent = state.surfers.length
        ? `${running} von ${state.surfers.length} aktiv · ${nf.format(blocked)} Anfragen blockiert`
        : 'Noch keine Surfer eingerichtet';
    $('nav-surfers').textContent = state.surfers.length ? `${running}/${state.surfers.length}` : '';
}

$('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('add-url');
    const res = await call('addSurfer', {url: url.value, name: $('add-name').value, start: $('add-start').checked});
    if (res) {
        url.value = '';
        $('add-name').value = '';
        url.classList.remove('invalid');
        toast(`„${res.name}“ hinzugefügt.`, 'ok');
    } else {
        url.classList.add('invalid');
        url.focus();
    }
});
$('add-url').addEventListener('input', e => e.target.classList.remove('invalid'));

// ---------- settings -----------------------------------------------------------------------------

const settingInputs = new Map();

function settingControl(item, section) {
    const current = () => (section === 'browser' ? state.browser : state.settings)[item.key];
    let input;
    const resetBtn = h('button', {class: 'reset-link', text: 'Standard', title: `Standardwert: ${item.type === 'bool' ? (item.default ? 'an' : 'aus') : item.default}`});

    const save = async value => {
        const method = section === 'browser' ? 'updateBrowser' : 'updateSettings';
        const res = await call(method, {[item.key]: value});
        if (!res) {
            syncSetting(item, section);
            return;
        }
        if (section === 'browser') {
            state.browser = res.value;
            state.restartRequired = res.restartRequired;
            renderRestartBanner();
        } else {
            state.settings = res.value;
            if (item.key === 'CUSTOM_USER_AGENT') $('ua-enabled').checked = value;
        }
        syncSetting(item, section);
    };

    if (item.type === 'bool') {
        input = h('input', {type: 'checkbox'});
        input.addEventListener('change', () => save(input.checked));
        const control = h('label', {class: 'switch'}, input, h('span', {class: 'switch-track'}));
        resetBtn.addEventListener('click', () => save(item.default));
        settingInputs.set(`${section}.${item.key}`, {input, resetBtn, item, section});
        return {control, resetBtn};
    }
    input = h('input', {type: 'number', min: item.min, max: item.max, step: '1'});
    let timer = null;
    const commit = () => {
        clearTimeout(timer);
        const v = Number(input.value);
        if (input.value === '' || !Number.isFinite(v) || v < item.min || v > item.max) {
            input.classList.add('invalid');
            toast(`${item.label}: erlaubt sind ${item.min} bis ${item.max}.`, 'error');
            return;
        }
        input.classList.remove('invalid');
        if (v !== current()) save(v);
    };
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(commit, 800);
    });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit();
    });
    resetBtn.addEventListener('click', () => save(item.default));
    settingInputs.set(`${section}.${item.key}`, {input, resetBtn, item, section});
    return {control: h('div', {class: 'setting-control'}, input, h('span', {class: 'unit', text: item.unit || ''})), resetBtn};
}

function syncSetting(item, section) {
    const entry = settingInputs.get(`${section}.${item.key}`);
    if (!entry) return;
    const value = (section === 'browser' ? state.browser : state.settings)[item.key];
    if (item.type === 'bool') entry.input.checked = Boolean(value);
    else if (document.activeElement !== entry.input) {
        entry.input.value = String(value);
        entry.input.classList.remove('invalid');
    }
    entry.resetBtn.hidden = value === item.default;
}

function renderSettingsForm() {
    const root = $('settings-groups');
    root.textContent = '';
    settingInputs.clear();
    const groups = [...state.schema.settings.map(g => ({...g, section: 'settings'})), ...state.schema.browser.map(g => ({...g, section: 'browser'}))];
    for (const g of groups) {
        const card = h('div', {class: 'card'},
            h('div', {class: 'card-head'}, h('h2', {text: g.label}), g.restart ? h('span', {class: 'badge', text: 'Neustart nötig'}) : null)
        );
        for (const item of g.items) {
            const {control, resetBtn} = settingControl(item, g.section);
            card.append(h('div', {class: 'setting'},
                h('div', {class: 'setting-text'},
                    h('div', {class: 'setting-label'}, item.label, resetBtn),
                    item.description ? h('div', {class: 'setting-desc', text: item.description}) : null
                ),
                control
            ));
        }
        root.append(card);
    }
    syncAllSettings();
}

function syncAllSettings() {
    for (const {item, section} of settingInputs.values()) syncSetting(item, section);
}

$('reset-settings').addEventListener('click', async () => {
    if (!(await confirmDialog('Alle Einstellungen zurücksetzen?', 'Alle Einstellungen und Browser-Optionen werden auf die Standardwerte gesetzt. Surfer und Listen bleiben erhalten.', 'Zurücksetzen'))) return;
    const res = await call('resetSettings');
    if (res) {
        applyConfig(res);
        toast('Einstellungen zurückgesetzt.', 'ok');
    }
});

function renderRestartBanner() {
    $('restart-banner').hidden = !state.restartRequired;
}

// ---------- lists --------------------------------------------------------------------------------

const LIST_META = {
    whitelist: {title: 'Whitelist', desc: 'Diese Domains werden nie blockiert. Popups und Navigation zu ihnen sind erlaubt.'},
    blockedDomains: {title: 'Gesperrte Domains', desc: 'Alle Anfragen an diese Domains werden blockiert.'},
    blockedExtensions: {title: 'Gesperrte Dateiendungen', desc: 'Anfragen auf Dateien mit diesen Endungen werden blockiert (z. B. .mp4).'},
    captchaWhitelist: {title: 'Captcha-Whitelist', desc: 'Captcha-Anbieter – werden vor allen anderen Filtern erlaubt.'}
};
const listEditors = new Map();

function renderLists() {
    const root = $('lists');
    root.textContent = '';
    listEditors.clear();
    for (const [name, meta] of Object.entries(LIST_META)) {
        const ta = h('textarea', {spellcheck: 'false', rows: '10'});
        const count = h('span', {class: 'list-count'});
        const rejected = h('div', {class: 'list-rejected', hidden: true});
        const saveBtn = h('button', {class: 'btn btn-primary btn-small', text: 'Speichern'});
        const resetBtn = h('button', {class: 'btn btn-ghost btn-small', text: 'Standard'});
        const ed = {ta, count, rejected, saveBtn};
        listEditors.set(name, ed);

        const updateCount = () => {
            const n = ta.value.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#')).length;
            const dirty = ta.value !== state.lists[name].join('\n');
            count.textContent = `${n} Einträge${dirty ? ' · ungespeichert' : ''}`;
            count.classList.toggle('dirty', dirty);
            saveBtn.disabled = !dirty;
        };
        ed.updateCount = updateCount;
        ta.addEventListener('input', updateCount);
        ta.addEventListener('keydown', e => {
            if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveBtn.click();
            }
        });
        saveBtn.addEventListener('click', async () => {
            const res = await call('setList', {name, entries: ta.value.split(/\r?\n/)});
            if (!res) return;
            state.lists[name] = res.value;
            ta.value = res.value.join('\n');
            rejected.hidden = !res.rejected.length;
            rejected.textContent = res.rejected.length ? `Ungültig und verworfen: ${res.rejected.join(', ')}` : '';
            updateCount();
            toast(`${meta.title} gespeichert.`, res.rejected.length ? 'warn' : 'ok');
        });
        resetBtn.addEventListener('click', async () => {
            if (!(await confirmDialog(`${meta.title} zurücksetzen?`, 'Die Liste wird durch die Standardeinträge ersetzt.', 'Zurücksetzen'))) return;
            const res = await call('resetList', name);
            if (!res) return;
            state.lists[name] = res.value;
            ta.value = res.value.join('\n');
            rejected.hidden = true;
            updateCount();
        });

        root.append(h('div', {class: 'card'},
            h('div', {class: 'card-head'}, h('h2', {text: meta.title})),
            h('p', {class: 'hint', text: meta.desc}),
            ta,
            rejected,
            h('div', {class: 'list-meta'}, count, h('div', {class: 'toolbar'}, resetBtn, saveBtn))
        ));
    }
    syncLists(true);
}

function syncLists(force) {
    for (const [name, ed] of listEditors) {
        const dirty = ed.ta.value !== (ed.lastSynced || '');
        if (force || !dirty) {
            ed.ta.value = state.lists[name].join('\n');
            ed.lastSynced = ed.ta.value;
        }
        ed.updateCount();
    }
}

$('ua-enabled').addEventListener('change', async e => {
    const res = await call('updateSettings', {CUSTOM_USER_AGENT: e.target.checked});
    if (res) {
        state.settings = res.value;
        syncAllSettings();
    } else e.target.checked = !e.target.checked;
});
$('ua-default').addEventListener('click', () => {
    $('ua-input').value = state.app.userAgentDefault;
});
$('ua-save').addEventListener('click', async () => {
    const res = await call('setUserAgent', $('ua-input').value);
    if (res) {
        state.userAgent = res.value;
        $('ua-input').value = res.value;
        toast('User-Agent gespeichert.', 'ok');
    }
});

// ---------- system -------------------------------------------------------------------------------

function meterClass(v, warn, err) {
    return v >= err ? 'meter-fill err' : v >= warn ? 'meter-fill warn' : 'meter-fill';
}

function renderStats() {
    const st = state.stats;
    if (!st) return;
    const s = state.settings;
    const ram = st.memory.percent;
    $('side-cpu').textContent = `${nf1.format(st.cpu)} %`;
    $('side-ram').textContent = `${nf1.format(ram)} %`;
    $('side-cpu-bar').style.width = `${Math.min(100, st.cpu)}%`;
    $('side-ram-bar').style.width = `${Math.min(100, ram)}%`;
    $('side-cpu-bar').className = meterClass(st.cpu, s.OVERLOAD_WARNING_CPU, s.OVERLOAD_THRESHOLD_CPU);
    $('side-ram-bar').className = meterClass(ram, s.OVERLOAD_WARNING_RAM, s.OVERLOAD_THRESHOLD_RAM);

    if (state.view !== 'system') return;
    $('t-cpu').textContent = `${nf1.format(st.cpu)} %`;
    $('t-ram').textContent = `${nf1.format(ram)} %`;
    $('t-ram-sub').textContent = `${nf.format(st.memory.usedMB)} / ${nf.format(st.memory.totalMB)} MB`;
    $('t-app').textContent = `${nf.format(st.appMemoryMB)} MB`;
    $('t-app-sub').textContent = `${st.processes.length} Prozesse · CPU ${nf1.format(st.appCpu)} %`;
    $('t-blocked').textContent = nf.format(st.totalBlocked);
    $('overload-status').textContent = st.overload.enabled
        ? `Überlastschutz aktiv · Überschreitungen ${st.overload.count}/${st.overload.limit}`
        : 'Überlastschutz ist ausgeschaltet (Einstellungen → Überwachung).';

    const body = $('proc-body');
    body.replaceChildren(...st.processes.map(p => h('tr', null,
        h('td', {text: String(p.pid)}),
        h('td', {text: p.name ? `${p.type} (${p.name})` : p.type}),
        h('td', {text: p.owner || ''}),
        h('td', {class: 'num', text: `${nf1.format(p.cpu)} %`}),
        h('td', {class: 'num', text: `${nf.format(p.memoryMB)} MB`})
    )));
    drawChart();
}

function drawChart() {
    const canvas = $('chart');
    const st = state.stats;
    if (!st || state.view !== 'system') return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const grid = css.getPropertyValue('--border').trim();
    const muted = css.getPropertyValue('--muted').trim();
    const padL = 34;
    const plotW = w - padL - 4;
    const plotH = hgt - 16;

    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (const v of [0, 25, 50, 75, 100]) {
        const y = 6 + plotH - (v / 100) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(y) + 0.5);
        ctx.lineTo(w - 4, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillText(`${v}%`, 0, y + 4);
    }
    const points = st.history;
    const maxN = 150;
    const line = (key, color) => {
        if (points.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        points.forEach((p, i) => {
            const x = padL + plotW - ((points.length - 1 - i) / (maxN - 1)) * plotW;
            const y = 6 + plotH - (Math.min(100, p[key]) / 100) * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    };
    line('mem', css.getPropertyValue('--ok').trim());
    line('cpu', css.getPropertyValue('--accent').trim());
}

window.addEventListener('resize', () => drawChart());

$('clear-shared').addEventListener('click', async () => {
    if (!(await confirmDialog('Gemeinsame Session leeren?', 'Cookies, Logins und Cache aller Surfer ohne eigene Session werden gelöscht.', 'Löschen'))) return;
    if (await call('clearSharedSession')) toast('Gemeinsame Session geleert.', 'ok');
});
document.querySelectorAll('[data-folder]').forEach(b => b.addEventListener('click', () => call('openFolder', b.dataset.folder)));

// ---------- log ----------------------------------------------------------------------------------

const LEVEL_LABEL = {debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'FEHLER', block: 'BLOCK'};
const MAX_LOG = 3000;
const MAX_LOG_DOM = 1500;
const logFilter = {levels: new Set(['info', 'warn', 'error', 'block']), text: ''};

function logMatches(e) {
    if (!logFilter.levels.has(e.level)) return false;
    if (!logFilter.text) return true;
    const t = logFilter.text;
    return e.message.toLowerCase().includes(t) || e.source.toLowerCase().includes(t);
}

function logRow(e) {
    return h('div', {class: `log-row lv-${e.level}`},
        h('span', {class: 'log-time', text: fmtTime(e.ts)}),
        h('span', {class: 'log-level', text: LEVEL_LABEL[e.level] || e.level}),
        h('span', {class: 'log-source', text: e.source, title: e.source}),
        h('span', {class: 'log-msg', text: e.message})
    );
}

function renderLog() {
    const el = $('log');
    const list = state.log.filter(logMatches).slice(-MAX_LOG_DOM);
    el.replaceChildren(...list.map(logRow));
    updateLogCount();
    scrollLogToEnd();
}

function updateLogCount() {
    $('log-count').textContent = `${nf.format(state.log.length)} Einträge im Speicher`;
}

function scrollLogToEnd() {
    if ($('log-follow').checked) {
        const el = $('log');
        el.scrollTop = el.scrollHeight;
    }
}

function appendLog(batch) {
    // entries logged before the window loaded arrive both via getState and the first batch
    const lastId = state.log.length ? state.log[state.log.length - 1].id : 0;
    const entries = batch.filter(e => e.id > lastId);
    if (!entries.length) return;
    state.log.push(...entries);
    if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
    const el = $('log');
    const frag = document.createDocumentFragment();
    for (const e of entries) {
        if (logMatches(e)) frag.append(logRow(e));
        if (e.level === 'error' && state.view !== 'log') state.unreadErrors++;
    }
    el.append(frag);
    while (el.childElementCount > MAX_LOG_DOM) el.firstElementChild.remove();
    $('nav-log').textContent = state.unreadErrors ? String(state.unreadErrors) : '';
    updateLogCount();
    scrollLogToEnd();
}

$('log-levels').addEventListener('click', e => {
    const chip = e.target.closest('.chip-toggle');
    if (!chip) return;
    chip.classList.toggle('active');
    if (chip.classList.contains('active')) logFilter.levels.add(chip.dataset.level);
    else logFilter.levels.delete(chip.dataset.level);
    renderLog();
});
let searchTimer = null;
$('log-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        logFilter.text = e.target.value.trim().toLowerCase();
        renderLog();
    }, 200);
});
$('log-follow').addEventListener('change', scrollLogToEnd);
$('log-clear').addEventListener('click', () => call('clearLog'));
$('log-export').addEventListener('click', async () => {
    if (await call('exportLog')) toast('Protokoll exportiert.', 'ok');
});

// ---------- updates ------------------------------------------------------------------------------

function renderUpdate() {
    const u = state.update;
    if (!u) return;
    const status = $('update-status');
    const texts = {
        idle: 'Noch nicht geprüft.',
        checking: 'Suche nach Updates …',
        none: `Surfer ist aktuell (Version ${u.current}).`,
        available: `Version ${u.latest} ist verfügbar (installiert: ${u.current}).`,
        downloading: `Lade Version ${u.latest} herunter …`,
        installing: 'Installiere Update …',
        installed: `Version ${u.latest} wurde installiert.`,
        error: `Fehler: ${u.message || 'unbekannt'}`
    };
    status.textContent = texts[u.status] || u.status;
    status.className = `update-status${u.status === 'available' || u.status === 'installed' ? ' available' : ''}${u.status === 'error' ? ' error' : ''}`;
    const busy = ['checking', 'downloading', 'installing'].includes(u.status);
    $('update-check').disabled = busy;
    $('update-install').hidden = !(u.status === 'available' && u.canInstall) && u.status !== 'installed';
    $('update-install').textContent = u.status === 'installed' ? (u.needsDependencyInstall ? 'Surfer beenden' : 'Jetzt neu starten') : 'Update installieren';
    $('update-install').disabled = busy;
    $('update-progress').hidden = u.status !== 'downloading';
    $('update-progress-fill').style.width = `${Math.round((u.progress || 0) * 100)}%`;

    let hint = '';
    if (u.status === 'available' && !u.canInstall) hint = u.reason || '';
    if (u.status === 'installed') {
        hint = u.needsDependencyInstall
            ? 'Die Abhängigkeiten haben sich geändert. Beende Surfer und starte ihn über start.bat / start.sh neu – die Abhängigkeiten werden dabei automatisch installiert.'
            : 'Starte Surfer neu, um die neue Version zu verwenden.';
        if (u.backup) hint += ` Sicherung der alten Version: ${u.backup}`;
    }
    $('update-hint').textContent = hint;

    const showBanner = u.status === 'available' || u.status === 'installed';
    $('update-banner').hidden = !showBanner || state.view === 'info';
    $('update-banner-text').textContent = u.status === 'installed' ? `Update auf ${u.latest} installiert – Neustart erforderlich.` : `Neue Version ${u.latest} verfügbar.`;
}

$('update-check').addEventListener('click', () => call('checkUpdate'));
$('update-install').addEventListener('click', async () => {
    const u = state.update;
    if (u.status === 'installed') {
        if (u.needsDependencyInstall) await call('quitApp');
        else await call('restartApp');
        return;
    }
    if (!(await confirmDialog(`Auf Version ${u.latest} aktualisieren?`, 'Die aktuelle Version wird im Ordner backup/ gesichert. Deine Konfiguration (config/) bleibt unverändert.', 'Installieren'))) return;
    call('installUpdate');
});
$('update-banner-open').addEventListener('click', () => {
    showView('info');
    renderUpdate();
});

// ---------- info ---------------------------------------------------------------------------------

function renderInfo() {
    const a = state.app;
    $('app-version').textContent = `Version ${a.version}`;
    const kv = $('info-kv');
    kv.textContent = '';
    const rowsKv = [
        ['Surfer', a.version],
        ['Electron', a.electron],
        ['Chromium', a.chrome],
        ['Node.js', a.node],
        ['System', a.platform],
        ['Konfiguration', a.paths.config],
        ['Protokolle', a.paths.logs],
        ['Browserprofil', a.paths.userData],
        ['Standard-User-Agent', a.userAgentDefault]
    ];
    for (const [k, v] of rowsKv) kv.append(h('dt', {text: k}), h('dd', {text: v}));
}

// ---------- state & events -----------------------------------------------------------------------

function applyConfig(cfg) {
    state.settings = cfg.settings;
    state.browser = cfg.browser;
    state.lists = cfg.lists;
    state.userAgent = cfg.userAgent;
    state.restartRequired = cfg.restartRequired;
    syncAllSettings();
    syncLists(false);
    $('ua-enabled').checked = state.settings.CUSTOM_USER_AGENT;
    if (document.activeElement !== $('ua-input')) $('ua-input').value = state.userAgent;
    renderRestartBanner();
}

async function init() {
    const data = await call('getState');
    if (!data) {
        document.body.textContent = 'Verbindung zum Hauptprozess fehlgeschlagen.';
        return;
    }
    Object.assign(state, {
        app: data.app,
        schema: data.schema,
        defaults: data.defaults,
        surfers: data.surfers,
        stats: data.stats,
        log: data.log,
        update: data.update,
        settings: data.settings,
        browser: data.browser,
        lists: data.lists,
        userAgent: data.userAgent
    });
    renderInfo();
    renderSettingsForm();
    renderLists();
    applyConfig(data);
    renderSurfers();
    renderStats();
    renderLog();
    renderUpdate();

    api.on('surfers', list => {
        state.surfers = list;
        renderSurfers();
    });
    api.on('stats', st => {
        state.stats = st;
        renderStats();
    });
    api.on('log', appendLog);
    api.on('log-cleared', () => {
        state.log = [];
        renderLog();
    });
    api.on('config', applyConfig);
    api.on('update', u => {
        state.update = u;
        renderUpdate();
        if (u.status === 'error' && u.userInitiated) toast(`Update: ${u.message}`, 'error', 6000);
    });
    api.on('notice', n => toast(n.message, n.type || 'info', n.ms || 4000));

    let saved = null;
    try {
        saved = localStorage.getItem('surfer.view');
    } catch { /* ignore */ }
    showView(saved && document.getElementById(`view-${saved}`) ? saved : 'surfers');
    renderUpdate();

    // Uptime and countdown labels tick even without updates from the main process.
    setInterval(() => {
        if (state.view === 'surfers') renderSurfers();
    }, 1000);
}

init();
