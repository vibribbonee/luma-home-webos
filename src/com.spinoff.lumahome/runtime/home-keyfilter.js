// Loaded by webOS's native key-filter shell. Only Home is consumed.
// A lease from the passive observer makes this fail open if it stops.
var lumaHomeLeaseUntil = Date.now() + 15000;
function init() {
    lunaCall.subscribe('com.webos.service.config', '/getConfigs', JSON.stringify({configNames:['com.webos.surfacemanager.lumaHomeLease']}), function(raw) {
        try {
            var data = JSON.parse(raw), value = data.configs && data.configs['com.webos.surfacemanager.lumaHomeLease'];
            if (typeof value === 'number' && value > 0) lumaHomeLeaseUntil = value + 15000;
        } catch (_) {}
    }, true);
}
function handleLumaHome(key, pressed, autoRepeat) {
    if ((key === Qt.Key_Super_L || key === Qt.Key_Menu || key === WebOS.Key_webOS_Recent) && Date.now() < lumaHomeLeaseUntil) return KeyPolicy.Accepted;
    return KeyPolicy.NextPolicy;
}
