/**
 * Wraps the signaling WebSocket. This channel only ever carries small
 * JSON control messages -- room codes, SDP, ICE candidates. It never
 * carries file bytes.
 */
export class Signaling {
  constructor() {
    this.ws = null;
    this._listeners = new Map(); // type -> Set<handler>
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${protocol}://${location.host}`);

      this.ws.addEventListener('open', () => resolve(this), { once: true });
      this.ws.addEventListener('error', (err) => reject(err), { once: true });

      this.ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const handlers = this._listeners.get(msg.type);
        if (handlers) handlers.forEach((fn) => fn(msg));
      });
    });
  }

  /** Subscribe to a message type. Returns an unsubscribe function. */
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
    return () => this._listeners.get(type).delete(handler);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  createRoom() {
    this.send({ type: 'create-room' });
  }

  joinRoom(code) {
    this.send({ type: 'join-room', code });
  }

  sendSignal(payload) {
    this.send({ type: 'signal', payload });
  }
}
