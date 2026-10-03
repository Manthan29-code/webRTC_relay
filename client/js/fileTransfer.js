// 64 KiB keeps each message comfortably under the SCTP message-size
// limits that vary across browsers/OSes for RTCDataChannel.
const CHUNK_SIZE = 64 * 1024;

// Backpressure watermarks: pause reading the file once the channel's
// internal send buffer grows past HIGH, resume once it drains below LOW.
// Without this, a fast sender + slow network would buffer the *entire*
// file in memory before it's actually sent -- defeating the point of
// streaming, and eventually crashing the tab on a large file.
const BUFFERED_HIGH_WATERMARK = 8 * 1024 * 1024; // 8 MB
const BUFFERED_LOW_WATERMARK = 1 * 1024 * 1024; // 1 MB

/**
 * Streams a File over a data channel in fixed-size chunks. Never holds
 * more than one chunk plus the OS-buffered backlog in memory, since
 * bytes are read directly from disk via File.slice() as they're sent --
 * so sender-side memory use doesn't grow with file size.
 */
export class FileSender {
  constructor(channel, file, callbacks = {}) {
    this.channel = channel;
    this.file = file;
    this.onProgress = callbacks.onProgress || (() => {});
    this.onComplete = callbacks.onComplete || (() => {});
    this.onError = callbacks.onError || (() => {});

    this.channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATERMARK;
    this._readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
  }

  /** Route incoming control messages here (the receiver's 'ready' ack). */
  handleMessage(data) {
    if (typeof data !== 'string') return;
    const msg = JSON.parse(data);
    if (msg.type === 'ready') this._resolveReady();
  }

  async start() {
    try {
      this.channel.send(JSON.stringify({
        type: 'meta',
        name: this.file.name,
        size: this.file.size,
        mime: this.file.type || 'application/octet-stream',
      }));

      // Wait for the receiver to confirm it has somewhere to put the
      // bytes (a chosen save location, or its in-memory fallback ready)
      // before streaming anything.
      await this._readyPromise;

      let offset = 0;
      while (offset < this.file.size) {
        await this._waitForBufferSpace();
        const slice = this.file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        this.channel.send(buffer);
        offset += buffer.byteLength;
        this.onProgress(offset, this.file.size);
      }

      this.channel.send(JSON.stringify({ type: 'end' }));
      this.onComplete();
    } catch (err) {
      this.onError(err);
    }
  }

  _waitForBufferSpace() {
    if (this.channel.bufferedAmount <= BUFFERED_HIGH_WATERMARK) return Promise.resolve();
    return new Promise((resolve) => {
      const handler = () => {
        this.channel.removeEventListener('bufferedamountlow', handler);
        resolve();
      };
      this.channel.addEventListener('bufferedamountlow', handler);
    });
  }
}

/**
 * Receives a chunked file. When the File System Access API is available
 * (Chromium-based browsers), it streams every incoming chunk straight
 * to disk via a FileSystemWritableFileStream, so there's no practical
 * size limit and memory use stays flat regardless of file size.
 *
 * Where that API isn't available (Firefox, Safari as of early 2026),
 * it falls back to buffering chunks in memory and assembling a Blob at
 * the end -- which *is* bounded by available RAM/tab memory. The UI
 * surfaces this distinction so it's never a silent limitation.
 */
export class FileReceiver {
  constructor(channel, callbacks = {}) {
    this.channel = channel;
    this.onMeta = callbacks.onMeta || (() => {});
    this.onProgress = callbacks.onProgress || (() => {});
    this.onComplete = callbacks.onComplete || (() => {});
    this.onError = callbacks.onError || (() => {});

    this._meta = null;
    this._received = 0;
    this._writer = null;
    this._fallbackChunks = null;
    this._mode = null; // 'stream' | 'blob'
  }

  get supportsUnlimitedSize() {
    return 'showSaveFilePicker' in window;
  }

  handleMessage(data) {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'meta') this._handleMeta(msg);
      if (msg.type === 'end') this._finish();
    } else {
      this._handleChunk(data);
    }
  }

  _handleMeta(meta) {
    this._meta = meta;
    this._received = 0;
    this.onMeta(meta, { supportsUnlimitedSize: this.supportsUnlimitedSize });
  }

  /**
   * Must be called from a user gesture (e.g. a button click) so the
   * browser will honor showSaveFilePicker(). Only after this resolves
   * does the sender start streaming bytes.
   */
  async prepareDestination() {
    try {
      if (this.supportsUnlimitedSize) {
        const handle = await window.showSaveFilePicker({ suggestedName: this._meta.name });
        this._writer = await handle.createWritable();
        this._mode = 'stream';
      } else {
        this._fallbackChunks = [];
        this._mode = 'blob';
      }
      this.channel.send(JSON.stringify({ type: 'ready' }));
    } catch (err) {
      // User cancelled the save dialog, etc.
      this.onError(err);
    }
  }

  async _handleChunk(buffer) {
    try {
      this._received += buffer.byteLength;
      if (this._mode === 'stream') {
        await this._writer.write(buffer);
      } else {
        this._fallbackChunks.push(buffer);
      }
      this.onProgress(this._received, this._meta.size);
    } catch (err) {
      this.onError(err);
    }
  }

  async _finish() {
    if (this._mode === 'stream') {
      await this._writer.close();
      this.onComplete({ mode: 'stream' });
    } else {
      const blob = new Blob(this._fallbackChunks, { type: this._meta.mime });
      const url = URL.createObjectURL(blob);
      this.onComplete({ mode: 'blob', url, name: this._meta.name });
    }
  }
}
