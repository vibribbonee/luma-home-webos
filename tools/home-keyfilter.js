// Loaded by webOS's native key-filter shell. Only Home is consumed.
// The observer's supervisor installs this policy only while input is available.
var lumaCycleInputs = false;
function init() {}
function handleLumaHome(key, pressed, autoRepeat) {
    if (key === Qt.Key_Super_L || key === Qt.Key_Menu || key === WebOS.Key_webOS_Recent) return KeyPolicy.Accepted;
    if (lumaCycleInputs && key === WebOS.Key_webOS_InputSource) return KeyPolicy.Accepted;
    return KeyPolicy.NextPolicy;
}
