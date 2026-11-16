(function () {
    'use strict';

    var launcher = document.getElementById('launcher');
    var tiles = document.getElementById('launcherTiles');
    var title = document.getElementById('launcherTitle');
    var dock = document.getElementById('launcherDock');
    var drawer = document.getElementById('launcherDrawer');
    var ordered = [];
    var icons = Object.create(null);

    function appArtwork(id) {
        var url = icons[id];
        var art = LumaIcons.tile(id, typeof url === 'string' && url.indexOf('data:image/png;base64,') === 0 ? url : '', true);
        var image = art.querySelector('img');
        if (image) { image.loading = 'lazy'; image.decoding = 'async'; }
        return art;
    }

    function tile(entry, onLaunch, showLabel) {
        var button = document.createElement('button');
        button.className = 'launcher-tile';
        button.dataset.appid = entry.id;
        button.setAttribute('aria-label', entry.title);
        if (entry.input) button.dataset.input = entry.input;
        var card = document.createElement('span');
        card.className = 'launcher-card';
        card.appendChild(entry.input ? LumaIcons.icon('monitor') : appArtwork(entry.id));
        button.appendChild(card);
        if (showLabel) {
            var label = document.createElement('span');
            label.className = 'launcher-tile-name';
            label.textContent = entry.title;
            button.appendChild(label);
        }
        button.onfocus = function () { title.textContent = entry.title; };
        button.onclick = function () { onLaunch(entry.id); };
        return button;
    }

    function render(entries, pins, onLaunch) {
        var bookmark = LumaNav.bookmark(tiles);
        var scroll = launcher.scrollTop;
        var preferred = pins.map(function (id) {
            return entries.filter(function (entry) { return entry.id === id; })[0];
        }).filter(Boolean);
        var docked = [];
        preferred.concat(entries).some(function (entry) {
            if (docked.indexOf(entry) < 0) docked.push(entry);
            return docked.length === 4;
        });
        dock.innerHTML = '';
        drawer.innerHTML = '';
        docked.forEach(function (entry) { dock.appendChild(tile(entry, onLaunch, false)); });
        entries.filter(function (entry) { return docked.indexOf(entry) < 0; })
            .forEach(function (entry) { drawer.appendChild(tile(entry, onLaunch, true)); });
        ordered = Array.from(tiles.querySelectorAll('.launcher-tile'));
        drawer.hidden = !drawer.firstChild;
        if (docked.length) title.textContent = docked[0].title;
        launcher.scrollTop = scroll;
        LumaNav.restore(tiles, bookmark);
    }

    function focusDock() {
        if (!dock.firstElementChild) return false;
        launcher.scrollTop = 0;
        return LumaNav.focus(dock.firstElementChild);
    }

    function setArtwork(available) {
        icons = available;
        ordered.forEach(function (button) {
            if (button.dataset.input || !Object.prototype.hasOwnProperty.call(icons, button.dataset.appid)) return;
            var card = button.firstElementChild;
            card.replaceChild(appArtwork(button.dataset.appid), card.firstElementChild);
        });
    }

    function handle(event) {
        var key = event.keyCode;
        var index = ordered.indexOf(document.activeElement);
        if (index < 0 || key < 37 || key > 40 || (key === 38 && index < 4)) return false;
        var column = index % 4;
        var next = key === 37 ? (column ? index - 1 : index)
            : key === 39 ? (column === 3 ? index : index + 1)
            : key === 38 ? index - 4
            : Math.floor(index / 4) * 4 + 4 < ordered.length ? Math.min(index + 4, ordered.length - 1) : index;
        if (ordered[next] && next !== index) LumaNav.focus(ordered[next]);
        event.preventDefault();
        return true;
    }

    // Keep the header in place when moving through the lower rows. Returning to
    // the dock restores the shelf and first row to their original position.
    dock.addEventListener('focusin', function () { launcher.scrollTop = 0; });
    window.LumaLauncher = {render: render, focusDock: focusDock, handle: handle, setArtwork: setArtwork};
})();
