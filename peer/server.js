'use strict';

// Inert until listen() is called by the platform adapter. Uses existing vendored ws.
const https = require('https');
const WebSocket = require('../src/com.spinoff.lumahome/runtime/vendor/ws');
const protocol = require('./protocol');

module.exports = function createPeerServer(options) {
  const device = protocol.identity(options.identity);
  const peers = new Map();
  const clients = new Set();
  let closing = false;
  function replacePeers(values) {
    const next = new Map();
    for (const peer of values) {
      if (!protocol.ID.test(peer.id) || !protocol.PIN.test(peer.fingerprint)
          || peer.id === device.id || next.has(peer.fingerprint)) throw Error('Invalid paired peer');
      next.set(peer.fingerprint, peer.id);
    }
    peers.clear(); next.forEach((id, pin) => peers.set(pin, id));
    // Unpair takes effect on existing sockets, not only new connections.
    for (const client of clients) if (peers.get(client.pin) !== client.peer) client.ws.terminate();
  }
  replacePeers(options.peers || []);
  function authenticated(request) {
    if (!request.socket.encrypted) return null;
    const cert = request.socket.getPeerCertificate();
    if (!cert.raw || !(Date.parse(cert.valid_from) <= Date.now())
        || !(Date.parse(cert.valid_to) > Date.now())) return null;
    const pin = protocol.fingerprint(cert.raw), peer = peers.get(pin);
    return peer ? {pin, peer} : null;
  }
  const server = https.createServer({key: options.key, cert: options.cert,
    requestCert: true, rejectUnauthorized: false, minVersion: 'TLSv1.2', handshakeTimeout: 5000}, (_request, response) => {
    response.writeHead(404); response.end();
  });
  server.maxConnections = 8;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.setTimeout(5000);
  server.on('tlsClientError', () => {});
  const websocket = new WebSocket.Server({noServer: true, maxPayload: 65536, perMessageDeflate: false});
  server.on('upgrade', (request, socket, head) => {
    const auth = authenticated(request);
    if (closing || request.url !== '/lumax/v1' || !auth || clients.size >= 4) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    websocket.handleUpgrade(request, socket, head, ws => connected(ws, auth));
  });
  function connected(ws, auth) {
    const client = {ws, pin: auth.pin, peer: auth.peer}; clients.add(client);
    const pending = new Set(), timers = new Set();
    let requests = 0, period = Date.now(), alive = true, lastId = 0;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!alive) return ws.terminate();
      alive = false; ws.ping();
    }, 15000);
    ws.on('close', () => { clearInterval(heartbeat); timers.forEach(clearTimeout); timers.clear(); clients.delete(client); });
    ws.on('error', () => {});
    function send(value) {
      let encoded;
      try { encoded = JSON.stringify(value); } catch (_) { return false; }
      if (Buffer.byteLength(encoded, 'utf8') > 1048576 || ws.bufferedAmount > 1048576) { ws.terminate(); return; }
      if (ws.readyState === WebSocket.OPEN) ws.send(encoded);
      return true;
    }
    send({type: 'hello', device});
    ws.on('message', (raw, binary) => {
      if (Buffer.isBuffer(raw) || binary === true) { ws.close(1003); return; }
      if (Date.now() - period >= 1000) { requests = 0; period = Date.now(); }
      if (++requests > 30) { ws.close(1008); return; }
      let request;
      try { request = JSON.parse(String(raw)); } catch (_) { ws.close(1007); return; }
      if (!request || !Number.isSafeInteger(request.id) || request.id <= lastId
          || !protocol.validate(request.command, request.args) || pending.has(request.id)
          || pending.size >= 8 || typeof options.handlers[request.command] !== 'function') {
        send({id: request && request.id, error: 'invalid_command'}); return;
      }
      lastId = request.id;
      pending.add(request.id);
      let expired = false;
      const timeout = setTimeout(() => {
        expired = true; send({id: request.id, error: 'timeout'});
      }, 3000);
      timers.add(timeout);
      Promise.resolve().then(() => {
        if (ws.readyState !== WebSocket.OPEN || peers.get(client.pin) !== client.peer)
          throw Error('Peer disconnected');
        return options.handlers[request.command](request.args, {peer: client.peer});
      })
        .then(result => {
          if (!expired && !send({id: request.id, result: result === undefined ? {} : result}))
            send({id: request.id, error: 'unavailable'});
        },
          () => { if (!expired) send({id: request.id, error: 'unavailable'}); })
        .then(() => { clearTimeout(timeout); timers.delete(timeout); pending.delete(request.id); });
    });
  }
  return {
    listen: (port, host, callback) => server.listen(port, host, callback),
    address: () => server.address(),
    onError: callback => server.on('error', callback),
    replacePeers,
    close: callback => {
      closing = true; for (const client of clients) client.ws.terminate();
      websocket.close(); server.close(callback);
    }
  };
};
