'use strict';

// Transport-independent command boundary. Never accepts shell or arbitrary Luna calls.
const crypto = require('crypto');
const VERSION = 1;
const SERVICE = '_lumax._tcp';
const ID = /^[a-f0-9]{32}$/;
const PIN = /^[a-f0-9]{64}$/;

function fingerprint(der) {
  return crypto.createHash('sha256').update(der).digest('hex');
}
function identity(value) {
  if (!value || !ID.test(value.id) || !['webos', 'android'].includes(value.platform))
    throw Error('Invalid Luma device identity');
  return {id: value.id, platform: value.platform, version: VERSION};
}
function advertisement(device) {
  device = identity(device);
  // Only public discovery metadata. Addresses and names are never authentication.
  return {id: device.id, platform: device.platform, version: String(VERSION)};
}
function candidate(txt, expected) {
  return !!txt && txt.id === expected && ID.test(txt.id)
    && String(txt.version) === String(VERSION) && ['webos', 'android'].includes(txt.platform);
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function validate(command, args) {
  if (!object(args)) return false;
  const keys = Object.keys(args).sort().join(',');
  switch (command) {
    case 'state': case 'catalog': case 'home': case 'close_overlay': return keys === '';
    case 'input': return keys === 'port' && [1, 2].includes(args.port);
    case 'launch': return keys === 'app' && typeof args.app === 'string'
      && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(args.app);
    case 'key': return keys === 'key,session' && typeof args.session === 'string'
      && ID.test(args.session) && ['up','down','left','right','ok','ok_hold','back','close'].includes(args.key);
    default: return false;
  }
}
module.exports = {VERSION, SERVICE, ID, PIN, fingerprint, identity, advertisement, candidate, validate};
