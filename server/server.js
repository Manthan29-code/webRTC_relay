'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./lib/roomManager');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Map vendor script URLs to their node_modules locations for first-party serving
const VENDOR_FILES = {
  '/vendor/qrcode.min.js': path.join(__dirname, 'node_modules', 'qrcode', 'build', 'qrcode.min.js'),
  '/vendor/jsQR.js': path.join(__dirname, 'node_modules', 'jsqr', 'dist', 'jsQR.js'),
  '/vendor/jszip.min.js': path.join(__dirname, 'node_modules', 'jszip', 'dist', 'jszip.min.js'),
};

// ---- Static file server -----------------------------------------------
// Note: this server only ever transports signaling messages (a few KB of
// JSON) and the tiny static client bundle. The actual file being shared
// never passes through it -- that happens peer-to-peer over WebRTC.
const httpServer = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  // Handle local vendor scripts from node_modules (with automatic CDN fallback if not yet installed)
  if (VENDOR_FILES[reqPath]) {
    const vendorPath = VENDOR_FILES[reqPath];
    fs.readFile(vendorPath, (err, data) => {
      if (err) {
        const cdnFallbacks = {
          '/vendor/qrcode.min.js': 'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js',
          '/vendor/jsQR.js': 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
          '/vendor/jszip.min.js': 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
        };
        if (cdnFallbacks[reqPath]) {
          res.writeHead(302, { Location: cdnFallbacks[reqPath] });
          return res.end();
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`Vendor module not found: ${reqPath}. Please run "npm install" in the server directory.`);
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(data);
    });
    return;
  }

  if (reqPath === '/') reqPath = '/index.html';

  const filePath = path.normalize(path.join(CLIENT_DIR, reqPath));
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---- Signaling relay ----------------------------------------------------
const wss = new WebSocketServer({ server: httpServer });
const rooms = new RoomManager();

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: 'error', message: 'Malformed message' });
    }

    switch (msg.type) {
      // Sender asks for a fresh 6-character room code.
      case 'create-room': {
        const code = rooms.createRoom(ws);
        send(ws, { type: 'room-created', code });
        break;
      }

      // Receiver submits a code (typed or scanned from the QR image).
      case 'join-room': {
        const code = String(msg.code || '').toUpperCase().trim();
        const result = rooms.joinRoom(code, ws);
        if (result.error === 'not_found') {
          send(ws, { type: 'error', message: 'Invalid or expired code.' });
        } else if (result.error === 'full') {
          send(ws, { type: 'error', message: 'This code is already in use.' });
        } else {
          send(ws, { type: 'room-joined', code });
          send(result.room.sender, { type: 'receiver-joined' });
        }
        break;
      }

      // Opaque relay for SDP offers/answers and ICE candidates. The
      // server never inspects `payload` -- it's WebRTC's business.
      case 'signal': {
        const peer = rooms.getPeer(ws);
        if (peer) send(peer, { type: 'signal', payload: msg.payload });
        break;
      }

      default:
        send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    const peer = rooms.handleDisconnect(ws);
    if (peer) {
      send(peer, { type: 'peer-left' });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Signaling + static server listening on http://localhost:${PORT}`);
});
