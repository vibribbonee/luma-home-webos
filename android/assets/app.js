'use strict';
const $ = id => document.getElementById(id);
const read = (value, fallback) => { try { return JSON.parse(value); } catch (_) { return fallback; } };
const host = window.LumaX;
let settings = read(host.preferences(), {});
let saved = read(localStorage.getItem('luma-tv'), null);
let client, retry, poll, noticeTimer, active = true;
let appSequence = 0;
let entries = [];
let androidApps = [];
const dockOrder = ['org.smarttube.stable', 'org.jellyfin.androidtv', 'com.netflix.ninja',
    'com.amazon.amazonvideo.livingroom', 'com.google.android.youtube.tv', 'com.android.vending'];
let states = new Map();
const pending = new Map();
const domains = {
    light: 'toggle', switch: 'toggle', fan: 'toggle', input_boolean: 'toggle',
    scene: 'turn_on', script: 'turn_on', input_button: 'press', button: 'press',
};

function say(message) {
    const notice = $('notice');
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
}
function connectionLabel(message) {
    $('status').textContent = message;
    $('pair-status').textContent = message;
}
function send(type, payload = {}) {
    if (!client || client.readyState !== WebSocket.OPEN || !client.authenticated) {
        return Promise.reject(new Error('Home Assistant is offline.'));
    }
    const id = ++appSequence;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('No reply from Home Assistant.')); }, 4500);
        pending.set(id, {resolve, reject, timer});
        client.send(JSON.stringify({id, type, ...payload}));
    });
}
function stopConnection() {
    clearTimeout(retry);
    clearInterval(poll);
    const socket = client;
    client = null;
    if (socket) socket.close();
    for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('Home Assistant disconnected.'));
    }
    pending.clear();
}
function connect() {
    stopConnection();
    if (!active || !settings.url || !settings.token) {
        connectionLabel(settings.url ? 'Home Assistant disconnected' : 'Pair Home Assistant in Settings for LG controls.');
        return;
    }
    connectionLabel('Connecting to Home Assistant…');
    const url = new URL(settings.url);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/websocket';
    const socket = new WebSocket(url);
    client = socket;
    socket.onmessage = async event => {
        if (client !== socket) return;
        const message = read(event.data, {});
        if (message.type === 'auth_required') {
            socket.send(JSON.stringify({type: 'auth', access_token: settings.token}));
        } else if (message.type === 'auth_invalid') {
            stopConnection();
            connectionLabel('Home Assistant rejected the access token.');
        } else if (message.type === 'auth_ok') {
            socket.authenticated = true;
            try {
                entries = await send('luma_home/list');
                showTvChoices();
                let tv = entries.find(item => item.tv_id === settings.tv);
                if (!tv && !settings.tv && entries.length === 1) {
                    tv = entries[0];
                    settings = {...settings, tv: tv.tv_id};
                    host.save(JSON.stringify(settings));
                }
                if (!tv) {
                    connectionLabel(entries.length ? 'Select your LG TV in Settings.' : 'Add Luma Home in Home Assistant first.');
                    return;
                }
                await refresh();
                connectionLabel('Home Assistant connected');
                poll = setInterval(() => refresh().catch(() => {}), 7000);
            } catch (error) {
                if (client === socket) connectionLabel(error.message);
            }
        } else if (message.type === 'event' && message.id === socket.overlays) {
            const event = message.event;
            if (!active || !['quick', 'notification'].includes(event?.kind)) return;
            try {
                const reply = await send('luma_home/lumax/ack', {
                    tv_id: settings.tv, renderer: socket.renderer, nonce: event.nonce,
                });
                if (reply.accepted && active && client === socket) showOverlay(event);
            } catch (_) {}
        } else if (message.type === 'result') {
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.success) request.resolve(message.result);
            else request.reject(new Error(message.error?.message || 'Home Assistant refused the request.'));
        }
    };
    socket.onclose = () => {
        if (client !== socket) return;
        stopConnection();
        connectionLabel('Offline · using the last saved app list');
        if (active) retry = setTimeout(connect, 3500);
    };
}

async function refresh() {
    const socket = client;
    const tv_id = settings.tv;
    const config = await send('luma_home/config/get', {tv_id});
    if (client !== socket) return;
    saved = config;
    localStorage.setItem('luma-tv', JSON.stringify(config));
    const identifiers = new Set([...(config.settings.controls || []), config.settings.temperature,
        config.settings.humidity, settings.co2 || config.settings.co2].filter(Boolean));
    const live = await send('luma_home/states', {tv_id, entity_ids: [...identifiers]});
    if (client !== socket) return;
    states = new Map(live.map(state => [state.entity_id, state]));
    render();
    if (socket.overlays === undefined) {
        socket.overlays = null;
        // New integrations support the foreground Streamer renderer. Older versions still use LG overlays.
        const sequence = appSequence + 1;
        try {
            const info = await send('luma_home/lumax/subscribe', {tv_id, streamer_input: streamerInput()});
            if (client === socket) {
                socket.renderer = info.renderer;
                socket.overlays = sequence;
            }
        } catch (_) {}
    }
}
function showTvChoices() {
    const choice = $('tv');
    choice.replaceChildren(new Option('Select a TV', ''));
    for (const item of entries) choice.add(new Option(item.name, item.tv_id));
    choice.value = settings.tv || '';
}
function label(state) {
    return state && !['unknown','unavailable'].includes(state.state) ?
        [state.state, state.attributes.unit_of_measurement].filter(Boolean).join(' ') : 'Unavailable';
}
function tile(name, badge, artwork, action) {
    const button = document.createElement('button');
    button.classList.add('tile');
    button.setAttribute('aria-label', name);
    const color = artwork?.tint;
    if (color && /^\d{1,3},\d{1,3},\d{1,3}$/.test(color)) button.style.setProperty('--tile-rgb', color);
    const source = artwork?.banner || artwork?.icon;
    if (source?.startsWith('data:image/png;base64,')) {
        const img = document.createElement('img');
        img.alt = '';
        img.className = artwork.banner ? 'banner' : 'app-icon';
        img.src = source;
        button.append(img);
    } else {
        const mark = document.createElement('span');
        mark.classList.add('mark');
        mark.textContent = badge;
        button.append(mark);
    }
    if (!artwork?.banner) {
        const title = document.createElement('span');
        title.textContent = name;
        button.append(title);
    }
    button.onfocus = () => {
        $('shelf').textContent = name;
        document.documentElement.style.setProperty('--glow-rgb', color || '104,91,170');
    };
    button.onclick = action;
    return button;
}
function service(domain, serviceName, service_data) {
    return send('call_service', {domain, service: serviceName, service_data}).catch(error => say(error.message));
}
function streamerInput() {
    const config = saved?.settings;
    return Number(config?.lumax_enabled ? config.lumax_input : settings.input || 1);
}
function render() {
    const config = saved?.settings || {};
    const hour = new Date().getHours();
    $('room').textContent = config.room || (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
    document.body.dataset.appearance = settings.appearance || 'black';
    const climate = $('climate');
    climate.replaceChildren();
    if (config.climate !== false) {
        for (const [title, id] of [['Temperature', config.temperature], ['Humidity', config.humidity], ['CO₂', settings.co2 || config.co2]]) {
            const state = states.get(id);
            if (!state || label(state) === 'Unavailable') continue;
            const span = document.createElement('span');
            span.textContent = title + ' ' + label(state);
            climate.append(span);
        }
    }
    const streamer = streamerInput();
    const tv = $('tv-apps');
    const input = $('tv-input');
    const available = Boolean(saved && saved.tv_id === settings.tv);
    input.hidden = tv.hidden = !available;
    if (available) {
        const catalog = (saved.catalog || []).filter(app => app.visible !== false).slice(0, 180);
        const key = JSON.stringify([streamer, config.hdmi1, config.hdmi2, catalog]);
        if (tv.dataset.key !== key) {
            const other = streamer === 2 ? 1 : 2;
            input.replaceChildren(tile(config['hdmi' + other] || 'HDMI ' + other, 'Input', null,
                () => service('luma_home', 'select_input', {input: other, entry_id: saved.entry_id})));
            tv.replaceChildren();
            for (const app of catalog) {
                if (app.id.startsWith('luma:') || /^com\.webos\.app\.hdmi/.test(app.id)) continue;
                tv.append(tile(app.title || app.id, 'LG', null,
                    () => service('luma_home', 'launch_app', {entry_id: saved.entry_id, app: app.id})));
            }
            tv.dataset.key = key;
        }
    }
    if (!$('panel').hidden && $('pair').hidden) renderControls();
}
function defaultFavorites() {
    const available = new Set(androidApps.map(app => app.id));
    return [...new Set([...dockOrder.filter(id => available.has(id)), ...available])].slice(0, 4);
}
function renderAndroid() {
    androidApps = read(host.catalog(), []);
    const pinned = settings.favorites || defaultFavorites();
    const dock = pinned.map(id => androidApps.find(item => item.id === id)).filter(Boolean);
    const tileFor = app => tile(app.name, 'App', app, () => host.launch(app.id));
    const buttons = dock.map(tileFor);
    $('dock').replaceChildren(...buttons);
    $('dock').hidden = !buttons.length;
    $('apps').replaceChildren(...androidApps.filter(app => !pinned.includes(app.id)).map(tileFor));
    if (document.activeElement === document.body) (buttons[0] || $('settings')).focus();
}
function favoriteChoices() {
    const favorites = $('favorites');
    favorites.replaceChildren();
    if (!androidApps.length) return;
    const chosen = settings.favorites || defaultFavorites();
    for (let i = 0; i < 4; i++) {
        const field = document.createElement('label');
        field.textContent = 'Favorite ' + (i + 1);
        const select = document.createElement('select');
        select.add(new Option('Empty', ''));
        for (const app of androidApps) select.add(new Option(app.name, app.id));
        select.value = chosen[i] || '';
        field.append(select);
        favorites.append(field);
    }
}
function renderControls() {
    const list = $('controls');
    const ids = saved?.settings?.controls || [];
    const key = JSON.stringify(ids);
    if (list.dataset.key !== key) {
        list.replaceChildren();
        for (const id of ids) {
            const domain = id.split('.')[0];
            if (!domains[domain]) continue;
            const button = document.createElement('button');
            button.className = 'control';
            button.dataset.entity = id;
            button.append(document.createElement('span'), document.createElement('span'));
            button.onclick = async () => {
                await service(domain, domains[domain], {entity_id: id});
                refresh().catch(() => {});
            };
            list.append(button);
        }
        if (!list.children.length) list.textContent = 'Add favorites in Luma Home to control them here.';
        list.dataset.key = key;
    }
    for (const button of list.querySelectorAll('button')) {
        const state = states.get(button.dataset.entity);
        button.firstChild.textContent = state?.attributes.friendly_name || button.dataset.entity;
        button.lastChild.textContent = label(state);
        button.disabled = !state || label(state) === 'Unavailable';
    }
}
function showOverlay(event) {
    if (event?.kind === 'quick') openPanel(false);
    if (event?.kind === 'notification') say([event.title, event.message].filter(Boolean).join(' · '));
}
function openPanel(pairing) {
    $('panel').hidden = false;
    $('panel-title').textContent = pairing ? 'Settings' : 'Room controls';
    $('pair').hidden = !pairing;
    $('controls').hidden = pairing;
    if (pairing) {
        $('url').value = settings.url || '';
        $('token').value = '';
        $('appearance').value = settings.appearance || 'black';
        favoriteChoices();
        $('input').value = settings.input || 1;
        showTvChoices();
    } else renderControls();
    $('close').focus();
}
function closePanel() {
    const pairing = !$('pair').hidden;
    $('panel').hidden = true;
    $(pairing ? 'settings' : 'quick').focus();
}
$('settings').onclick = () => openPanel(true);
$('quick').onclick = () => openPanel(false);
$('close').onclick = closePanel;
$('default-home').onclick = () => host.homeSettings();
$('google-home').onclick = () => host.googleHome();
$('forget').onclick = () => {
    stopConnection();
    const disconnected = {appearance: settings.appearance, favorites: settings.favorites};
    if (!host.save(JSON.stringify(disconnected))) { say('Could not remove the saved connection.'); return; }
    settings = disconnected;
    saved = null;
    entries = [];
    states.clear();
    localStorage.removeItem('luma-tv');
    $('tv-apps').dataset.key = '';
    openPanel(true);
    render();
    connect();
};
$('pair').onsubmit = event => {
    event.preventDefault();
    try {
        const favorites = [...$('favorites').querySelectorAll('select')].map(select => select.value).filter(Boolean);
        if (new Set(favorites).size !== favorites.length) throw new Error('Choose a different app for each favorite.');
        const appearance = $('appearance').value;
        const address = $('url').value.trim();
        if (!address) {
            if (settings.url) throw new Error('Use Disconnect Home Assistant to remove the saved connection.');
            const change = {...settings, appearance, favorites};
            if (!host.save(JSON.stringify(change))) throw new Error('Could not store these settings.');
            settings = change;
            renderAndroid();
            render();
            say('Settings saved.');
            return;
        }
        const endpoint = new URL(address);
        if (!['http:','https:'].includes(endpoint.protocol) || endpoint.pathname !== '/' ||
            endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
            throw new Error('Enter the Home Assistant base address.');
        }
        const token = $('token').value.trim() || (settings.url === endpoint.origin ? settings.token : '');
        if (!token) throw new Error('Enter a Home Assistant access token.');
        const change = {url: endpoint.origin, token, tv: $('tv').value, input: $('input').value, appearance, favorites};
        if (!host.save(JSON.stringify(change))) throw new Error('Could not store this connection.');
        if (change.url !== settings.url || change.tv !== settings.tv) {
            saved = null;
            states.clear();
            localStorage.removeItem('luma-tv');
            $('tv-apps').dataset.key = '';
        }
        settings = change;
        $('token').value = '';
        renderAndroid();
        render();
        connect();
    } catch (error) { connectionLabel(error.message); }
};
function clock() {
    const now = new Date();
    $('clock').textContent = new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(now);
    $('date').textContent = new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(now);
}
window.lumaEvent = event => {
    if (event === 'catalog') renderAndroid();
    if (event === 'pause') { active = false; stopConnection(); }
    if (event === 'resume' || event === 'home') {
        active = true;
        if (!client) connect();
    }
    if (event === 'back' && !$('panel').hidden) {
        closePanel();
        return true;
    }
    if (event === 'home') {
        if (!$('panel').hidden) closePanel();
        else ($('dock').firstElementChild || $('quick')).focus();
    }
};

document.addEventListener('keydown', event => {
    const steps = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
    const step = steps[event.key];
    const current = document.activeElement;
    if (!step || current.matches('input,select')) return;
    event.preventDefault();
    const root = $('panel').hidden ? document.querySelector('main') : $('panel');
    const nodes = [...root.querySelectorAll('button:not(:disabled),input,select')].filter(node => node.getClientRects().length);
    if (!nodes.includes(current)) { nodes[0]?.focus(); return; }
    const from = current.getBoundingClientRect();
    const axis = step[0] ? 'x' : 'y';
    const cross = step[0] ? 'y' : 'x';
    const position = (rect, direction) => direction === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    let closest, best = Infinity;
    for (const node of nodes) {
        const to = node.getBoundingClientRect();
        const ahead = (position(to, axis) - position(from, axis)) * (step[0] || step[1]);
        if (ahead < 8) continue;
        const delta = Math.abs(position(to, cross) - position(from, cross));
        const score = ahead + 3 * delta;
        if (score < best) { closest = node; best = score; }
    }
    closest?.focus();
});
clock();
setInterval(clock, 15000);
renderAndroid();
render();
connect();
