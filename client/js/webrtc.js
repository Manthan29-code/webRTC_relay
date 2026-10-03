// Public STUN servers only, used to discover each peer's public IP/port
// so the direct connection can be attempted. There's no TURN server
// configured here, so a direct path will fail on some restrictive
// corporate/mobile NATs -- see the README for how to add one.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DATA_CHANNEL_LABEL = 'file-transfer';

/**
 * Wraps RTCPeerConnection for either role:
 *  - the sender creates the data channel and the initial offer
 *  - the receiver waits for both and answers
 * ICE candidates and SDP are relayed through the `signaling` instance.
 */
export class PeerConnection {
  constructor(signaling, role) {
    this.signaling = signaling;
    this.role = role; // 'sender' | 'receiver'
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;

    this.onChannelOpen = null;
    this.onChannelClose = null;
    this.onMessage = null;
    this.onConnectionStateChange = null;

    this.pc.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        this.signaling.sendSignal({ candidate: event.candidate });
      }
    });

    this.pc.addEventListener('connectionstatechange', () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    });

    if (role === 'sender') {
      this.channel = this.pc.createDataChannel(DATA_CHANNEL_LABEL);
      this._wireChannel(this.channel);
    } else {
      this.pc.addEventListener('datachannel', (event) => {
        this.channel = event.channel;
        this._wireChannel(this.channel);
      });
    }

    signaling.on('signal', (msg) => this._handleSignal(msg.payload));
  }

  _wireChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => this.onChannelOpen?.());
    channel.addEventListener('close', () => this.onChannelClose?.());
    channel.addEventListener('message', (event) => this.onMessage?.(event.data));
  }

  /** Sender calls this once it knows the receiver has joined the room. */
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.sendSignal({ sdp: this.pc.localDescription });
  }

  async _handleSignal(payload) {
    if (payload.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      if (payload.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling.sendSignal({ sdp: this.pc.localDescription });
      }
    } else if (payload.candidate) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch (err) {
        console.warn('Failed to add ICE candidate', err);
      }
    }
  }

  close() {
    this.channel?.close();
    this.pc.close();
  }
}
