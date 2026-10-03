// Uses the global `QRCode` (from the qrcode CDN bundle) and `jsQR`
// (from the jsQR CDN bundle) -- see index.html for the <script> tags.
// Kept in one module so the rest of the app never touches those globals
// directly.

/** Renders `text` (the room code) as a QR image onto the given canvas. */
export async function renderQrCode(canvas, text) {
  // Wait briefly if script is still loading
  if (!window.QRCode) {
    for (let i = 0; i < 20 && !window.QRCode; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (!window.QRCode) {
    console.error('QRCode library is not loaded');
    return;
  }

  try {
    await window.QRCode.toCanvas(canvas, text, {
      width: 220,
      margin: 1,
      color: { dark: '#15171c', light: '#eceae4' },
    });
  } catch (err) {
    console.error('Failed to render QR code:', err);
  }
}

/**
 * Continuously scans camera frames for a QR code until one is found or
 * stop() is called. Calls onDecode(text) at most once per scanner.
 */
export class QrScanner {
  constructor(videoEl, canvasEl, onDecode) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.onDecode = onDecode;
    this._stream = null;
    this._rafId = null;
  }

  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    this.video.srcObject = this._stream;
    await this.video.play();
    this._tick();
  }

  _tick() {
    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

      const frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const result = window.jsQR(frame.data, frame.width, frame.height);
      if (result?.data) {
        this.onDecode(result.data);
        this.stop();
        return;
      }
    }
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._stream?.getTracks().forEach((track) => track.stop());
    this._rafId = null;
    this._stream = null;
  }
}
