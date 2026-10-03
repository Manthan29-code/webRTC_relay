# Relay — WebRTC peer-to-peer file transfer

Sends a file directly from one browser to another over a `RTCDataChannel`.
The Node server only relays the small signaling messages needed to set up
that connection (room codes, SDP, ICE candidates) — the file itself never
touches the server.

## Project layout

```
webrtc-relay/
├── server/
│   ├── server.js            # static file host + WebSocket signaling relay
│   └── lib/
│       ├── roomManager.js   # tracks code -> {sender, receiver} pairs
│       └── codeGenerator.js # crypto-random 6-char room codes
└── client/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js           # orchestrates everything below
        ├── signaling.js     # WebSocket wrapper
        ├── webrtc.js        # RTCPeerConnection + SDP/ICE exchange
        ├── fileTransfer.js  # chunked send/receive, backpressure, disk streaming
        ├── qr.js            # QR generation (sender) + camera scanning (receiver)
        ├── codeUtils.js     # code formatting/validation shared helpers
        └── ui.js            # DOM refs + view-state helpers
```

## Running it

```bash
cd server
npm install
npm start
# -> http://localhost:3000
```

Open that URL in two different browsers/tabs/devices to test send + receive.
For a phone to reach a server on your laptop, use your laptop's LAN IP
instead of `localhost`, and note the QR scanner needs **HTTPS** (or
`localhost`) — browsers block camera access on plain HTTP for any other
host, so scanning across devices needs a TLS reverse proxy (e.g. ngrok,
Caddy, or your host's built-in HTTPS) in front of this server.

## How a transfer works

1. **Sender** picks a file → the server hands back a random 6-character
   code and the client renders it as a QR code.
2. **Receiver** either scans that QR (camera, decoded in-browser with
   jsQR) or types the code in manually.
3. The server pairs the two sockets in a "room" and relays one SDP offer,
   one SDP answer, and a handful of ICE candidates between them — that's
   the entire signaling job.
4. Once a direct connection forms, the file streams over the data channel
   in 64 KB chunks, with backpressure (`bufferedamountlow`) so the sender
   never buffers more than ~8 MB ahead of what's actually been sent.
5. The receiver writes each chunk straight to disk via the File System
   Access API (`showSaveFilePicker` + `createWritable`) when the browser
   supports it — Chrome, Edge, and other Chromium browsers do. That's
   what makes "no size limit" true: memory use stays flat regardless of
   file size, because nothing is held in RAM.

## Being honest about "no file size limit"

That claim depends on the receiver's browser:

- **Chromium-based browsers** (Chrome, Edge, Opera, Brave): streams
  directly to disk. File size is limited only by the receiver's free
  disk space.
- **Firefox / Safari**: as of early 2026 neither ships the File System
  Access API, so the app falls back to buffering incoming chunks in
  memory and assembling a `Blob` at the end. That fallback *is* bounded
  by the tab's available RAM — the UI tells the receiver which mode
  they're getting before the transfer starts.

## Known limitations / next steps

- **STUN only, no TURN.** Some restrictive NATs (many corporate networks,
  some carrier-grade NAT on mobile) can't establish a direct path with
  STUN alone. Add a TURN server (e.g. coturn, or a hosted TURN provider)
  to the `ICE_SERVERS` array in `client/js/webrtc.js` for full reliability.
- **One receiver per code.** A room closes as soon as one receiver joins;
  this is intentional (a code is a one-time handshake, not a public link).
- **No resumable transfers.** If either side disconnects mid-transfer,
  the whole thing has to restart.
