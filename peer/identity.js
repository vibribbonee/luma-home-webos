'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const protocol = require('./protocol');

// The platform adapter passes its own dedicated private app-data directory.
// Corruption is an error, never an excuse to silently replace a paired identity.
module.exports = function loadIdentity(directory, platform) {
  const file = path.join(directory, 'device.json');
  try {
    const saved = protocol.identity(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (saved.platform !== platform) throw Error('Luma identity belongs to another platform');
    return saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const device = protocol.identity({id: crypto.randomBytes(16).toString('hex'), platform});
  try { fs.mkdirSync(directory, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  fs.chmodSync(directory, 0o700);
  try { fs.writeFileSync(file, JSON.stringify(device), {flag: 'wx', mode: 0o600}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; return module.exports(directory, platform); }
  return device;
};
