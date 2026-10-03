'use strict';

const { generateUniqueCode } = require('./codeGenerator');

// Rooms that never get a receiver are garbage-collected after this long.
const ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Tracks active rooms. A "room" only ever holds two sockets: the sender
 * that requested a code, and the one receiver that joined with it. The
 * server never sees file bytes -- it only relays small signaling
 * messages (SDP offers/answers, ICE candidates) between the two.
 */
class RoomManager {
  constructor() {
    /** @type {Map<string, {sender: WebSocket, receiver: WebSocket|null, createdAt: number}>} */
    this.rooms = new Map();
    this._sweepTimer = setInterval(() => this._sweepExpired(), 60 * 1000);
  }

  createRoom(senderWs) {
    const code = generateUniqueCode(new Set(this.rooms.keys()));
    this.rooms.set(code, { sender: senderWs, receiver: null, createdAt: Date.now() });
    senderWs.roomCode = code;
    senderWs.role = 'sender';
    return code;
  }

  joinRoom(code, receiverWs) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'not_found' };
    if (room.receiver) return { error: 'full' };
    if (room.sender.readyState !== room.sender.OPEN) return { error: 'not_found' };

    room.receiver = receiverWs;
    receiverWs.roomCode = code;
    receiverWs.role = 'receiver';
    return { room };
  }

  /** Returns the other socket in this socket's room, if any. */
  getPeer(ws) {
    const room = this.rooms.get(ws.roomCode);
    if (!room) return null;
    return ws.role === 'sender' ? room.receiver : room.sender;
  }

  removeRoom(code) {
    this.rooms.delete(code);
  }

  /** Call on socket close/error to notify the peer and free the room. */
  handleDisconnect(ws) {
    const code = ws.roomCode;
    if (!code) return;
    const peer = this.getPeer(ws);
    this.removeRoom(code);
    return peer;
  }

  _sweepExpired() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const isStale = !room.receiver && now - room.createdAt > ROOM_TTL_MS;
      if (isStale) this.rooms.delete(code);
    }
  }

  stop() {
    clearInterval(this._sweepTimer);
  }
}

module.exports = { RoomManager };
