// 64 KiB keeps each message comfortably under the SCTP message-size
// limits that vary across browsers/OSes for RTCDataChannel.
const CHUNK_SIZE = 64 * 1024;

// Backpressure watermarks: pause reading the file once the channel's
// internal send buffer grows past HIGH, resume once it drains below LOW.
const BUFFERED_HIGH_WATERMARK = 8 * 1024 * 1024; // 8 MB
const BUFFERED_LOW_WATERMARK = 1 * 1024 * 1024;  // 1 MB

/**
 * Streams multiple files and nested folders sequentially over an RTCDataChannel.
 * Uses a two-phase protocol:
 * 1. Manifest exchange: sender sends file list, receiver selectively confirms which to receive.
 * 2. Sequential file streaming: each file is acknowledged with flow-control backpressure.
 */
export class FileSender {
  constructor(channel, files, callbacks = {}) {
    this.channel = channel;
    this.files = files; // Array of { id, file, name, path, size, mime }
    this.callbacks = {
      onManifestSent: callbacks.onManifestSent || (() => {}),
      onFileStart: callbacks.onFileStart || (() => {}),
      onFileProgress: callbacks.onFileProgress || (() => {}),
      onTotalProgress: callbacks.onTotalProgress || (() => {}),
      onFileComplete: callbacks.onFileComplete || (() => {}),
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    if (this.channel) {
      this.channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATERMARK;
    }

    this._pendingAcks = new Map(); // type -> resolve function
    this._cancelled = false;
  }

  handleMessage(data) {
    if (typeof data !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === 'manifest-ack') {
      const resolver = this._pendingAcks.get('manifest-ack');
      if (resolver) {
        this._pendingAcks.delete('manifest-ack');
        resolver(msg);
      }
    } else if (msg.type === 'file-ready') {
      const resolver = this._pendingAcks.get(`file-ready-${msg.id}`);
      if (resolver) {
        this._pendingAcks.delete(`file-ready-${msg.id}`);
        resolver(msg);
      }
    } else if (msg.type === 'file-ack') {
      const resolver = this._pendingAcks.get(`file-ack-${msg.id}`);
      if (resolver) {
        this._pendingAcks.delete(`file-ack-${msg.id}`);
        resolver(msg);
      }
    }
  }

  cancel() {
    this._cancelled = true;
  }

  async start() {
    try {
      const totalBatchBytes = this.files.reduce((acc, f) => acc + f.size, 0);

      // 1. Send Manifest
      const manifestMsg = {
        type: 'manifest',
        files: this.files.map((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          size: f.size,
          mime: f.mime,
        })),
        totalSize: totalBatchBytes,
      };

      this.channel.send(JSON.stringify(manifestMsg));
      this.callbacks.onManifestSent(manifestMsg);

      // Wait for receiver's manifest ACK with selected IDs
      const manifestAck = await new Promise((resolve) => {
        this._pendingAcks.set('manifest-ack', resolve);
      });

      if (!manifestAck.accepted || !manifestAck.selectedIds || manifestAck.selectedIds.length === 0) {
        this.callbacks.onComplete({ cancelled: true, message: 'Receiver declined or selected 0 files.' });
        return;
      }

      const selectedIdSet = new Set(manifestAck.selectedIds);
      const queue = this.files.filter((f) => selectedIdSet.has(f.id));
      const totalSelectedBytes = queue.reduce((acc, f) => acc + f.size, 0);
      let cumulativeBytesSent = 0;

      // 2. Stream each selected file sequentially
      for (let i = 0; i < queue.length; i++) {
        if (this._cancelled) break;
        const fileEntry = queue[i];

        this.callbacks.onFileStart(fileEntry, i + 1, queue.length);

        // Notify receiver to prepare destination for this file
        this.channel.send(
          JSON.stringify({
            type: 'file-start',
            id: fileEntry.id,
            name: fileEntry.name,
            path: fileEntry.path,
            size: fileEntry.size,
            mime: fileEntry.mime,
            index: i + 1,
            total: queue.length,
          })
        );

        // Wait until receiver confirms it is ready to receive bytes
        await new Promise((resolve) => {
          this._pendingAcks.set(`file-ready-${fileEntry.id}`, resolve);
        });

        // Stream file chunks
        let offset = 0;
        const domFile = fileEntry.file;

        while (offset < fileEntry.size) {
          if (this._cancelled) break;
          await this._waitForBufferSpace();

          const slice = domFile.slice(offset, offset + CHUNK_SIZE);
          const buffer = await slice.arrayBuffer();
          this.channel.send(buffer);

          offset += buffer.byteLength;
          cumulativeBytesSent += buffer.byteLength;

          this.callbacks.onFileProgress(fileEntry.id, offset, fileEntry.size);
          this.callbacks.onTotalProgress(cumulativeBytesSent, totalSelectedBytes);
        }

        if (this._cancelled) break;

        // Signal end of this file and wait for receiver disk flush/ack
        this.channel.send(JSON.stringify({ type: 'file-end', id: fileEntry.id }));
        await new Promise((resolve) => {
          this._pendingAcks.set(`file-ack-${fileEntry.id}`, resolve);
        });

        this.callbacks.onFileComplete(fileEntry);
      }

      // 3. Signal batch complete
      if (!this._cancelled) {
        this.channel.send(JSON.stringify({ type: 'all-done' }));
        this.callbacks.onComplete({ count: queue.length, totalBytes: totalSelectedBytes });
      }
    } catch (err) {
      this.callbacks.onError(err);
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
 * Receives multi-file & folder batches over an RTCDataChannel.
 * Supports:
 * - Chromium desktop: window.showDirectoryPicker() for zero-memory direct-to-disk streaming
 * - Safari / Firefox / Mobile: In-browser JSZip bundling for 1-click single-archive download
 */
export class FileReceiver {
  constructor(channelOrGetter, callbacks = {}) {
    this._channelOrGetter = channelOrGetter;
    this.callbacks = {
      onManifest: callbacks.onManifest || (() => {}),
      onFileStart: callbacks.onFileStart || (() => {}),
      onFileProgress: callbacks.onFileProgress || (() => {}),
      onTotalProgress: callbacks.onTotalProgress || (() => {}),
      onFileComplete: callbacks.onFileComplete || (() => {}),
      onComplete: callbacks.onComplete || (() => {}),
      onError: callbacks.onError || (() => {}),
    };

    this._manifest = null;
    this._selectedIds = new Set();
    this._mode = null; // 'directory' | 'zip' | 'single-stream'
    this._dirHandle = null;
    this._singleFileHandle = null;
    this._currentFile = null;
    this._currentWriter = null;
    this._currentFileChunks = null;
    this._currentFileReceived = 0;
    this._totalReceived = 0;
    this._totalSelectedBytes = 0;
    this._zip = null;
    this._completedCount = 0;
  }

  get channel() {
    if (typeof this._channelOrGetter === 'function') {
      return this._channelOrGetter();
    }
    return this._channelOrGetter;
  }

  set channel(ch) {
    this._channelOrGetter = ch;
  }

  _send(msg) {
    const ch = this.channel;
    if (!ch) {
      throw new Error('DataChannel is not connected yet.');
    }
    if (ch.readyState !== 'open') {
      throw new Error(`DataChannel is not open (current state: ${ch.readyState})`);
    }
    ch.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  get supportsDirectoryPicker() {
    return 'showDirectoryPicker' in window;
  }

  get supportsSaveFilePicker() {
    return 'showSaveFilePicker' in window;
  }

  handleMessage(data) {
    if (typeof data === 'string') {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.type === 'manifest') {
        this._handleManifest(msg);
      } else if (msg.type === 'file-start') {
        this._handleFileStart(msg);
      } else if (msg.type === 'file-end') {
        this._handleFileEnd(msg);
      } else if (msg.type === 'all-done') {
        this._handleAllDone();
      }
    } else {
      this._handleChunk(data);
    }
  }

  _handleManifest(manifest) {
    this._manifest = manifest;
    this.callbacks.onManifest(manifest, {
      supportsDirectoryPicker: this.supportsDirectoryPicker,
      supportsSaveFilePicker: this.supportsSaveFilePicker,
    });
  }

  /**
   * Called in response to user clicking "Receive Selected Files".
   * Sets up destination (directory picker or ZIP archive) and ACKs the manifest.
   */
  async acceptManifest(selectedIds) {
    try {
      this._selectedIds = new Set(selectedIds);
      const selectedFiles = this._manifest.files.filter((f) => this._selectedIds.has(f.id));
      this._totalSelectedBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);

      const hasFolders = selectedFiles.some((f) => f.path.includes('/'));

      if (this.supportsDirectoryPicker && (hasFolders || selectedFiles.length > 1)) {
        // Desktop Chromium with multiple files/folders: pick destination directory
        this._dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        this._mode = 'directory';
      } else if (selectedFiles.length === 1 && this.supportsSaveFilePicker) {
        // Single file on Chromium: pick destination file
        const fileHandle = await window.showSaveFilePicker({ suggestedName: selectedFiles[0].name });
        this._dirHandle = null;
        this._singleFileHandle = fileHandle;
        this._mode = 'single-stream';
      } else {
        // Fallback: Bundle in browser as ZIP archive
        this._mode = 'zip';
        if (typeof window.JSZip !== 'undefined') {
          this._zip = new window.JSZip();
        } else {
          console.warn('JSZip not found, falling back to memory blob collection.');
        }
      }

      // Send ACK with approved file IDs to sender
      this._send({
        type: 'manifest-ack',
        accepted: true,
        selectedIds: Array.from(this._selectedIds),
      });
    } catch (err) {
      // User cancelled picker dialog or permission denied
      this.callbacks.onError(err);
    }
  }

  async _handleFileStart(msg) {
    try {
      this._currentFile = msg;
      this._currentFileReceived = 0;

      if (this._mode === 'directory') {
        // Ensure subfolder hierarchy exists in chosen directory
        const parts = msg.path.split('/').filter(Boolean);
        const fileName = parts.pop();
        let targetDir = this._dirHandle;

        for (const dirName of parts) {
          targetDir = await targetDir.getDirectoryHandle(dirName, { create: true });
        }

        const fileHandle = await targetDir.getFileHandle(fileName, { create: true });
        this._currentWriter = await fileHandle.createWritable();
      } else if (this._mode === 'single-stream') {
        this._currentWriter = await this._singleFileHandle.createWritable();
      } else {
        // ZIP or memory fallback
        this._currentFileChunks = [];
      }

      this.callbacks.onFileStart(msg);

      // Signal sender that destination is ready to receive binary chunks
      this._send({ type: 'file-ready', id: msg.id });
    } catch (err) {
      this.callbacks.onError(err);
    }
  }

  async _handleChunk(buffer) {
    try {
      this._currentFileReceived += buffer.byteLength;
      this._totalReceived += buffer.byteLength;

      if (this._currentWriter) {
        await this._currentWriter.write(buffer);
      } else if (this._currentFileChunks) {
        this._currentFileChunks.push(buffer);
      }

      this.callbacks.onFileProgress(this._currentFile.id, this._currentFileReceived, this._currentFile.size);
      this.callbacks.onTotalProgress(this._totalReceived, this._totalSelectedBytes);
    } catch (err) {
      this.callbacks.onError(err);
    }
  }

  async _handleFileEnd(msg) {
    try {
      if (this._currentWriter) {
        await this._currentWriter.close();
        this._currentWriter = null;
      } else if (this._mode === 'zip' && this._zip) {
        const fileBlob = new Blob(this._currentFileChunks, { type: this._currentFile.mime });
        this._zip.file(this._currentFile.path, fileBlob);
        this._currentFileChunks = null;
      }

      this._completedCount++;
      this.callbacks.onFileComplete(this._currentFile);

      // Acknowledge file completion so sender proceeds to next file
      this._send({ type: 'file-ack', id: msg.id });
    } catch (err) {
      this.callbacks.onError(err);
    }
  }

  async _handleAllDone() {
    try {
      if (this._mode === 'directory') {
        this.callbacks.onComplete({
          mode: 'directory',
          count: this._completedCount,
          totalBytes: this._totalReceived,
        });
      } else if (this._mode === 'single-stream') {
        this.callbacks.onComplete({
          mode: 'single-stream',
          count: 1,
          totalBytes: this._totalReceived,
        });
      } else if (this._mode === 'zip' && this._zip) {
        const zipBlob = await this._zip.generateAsync({
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 5 },
        });
        const zipUrl = URL.createObjectURL(zipBlob);
        this.callbacks.onComplete({
          mode: 'zip',
          url: zipUrl,
          name: 'relay-transfer.zip',
          count: this._completedCount,
          totalBytes: this._totalReceived,
        });
      } else {
        this.callbacks.onComplete({
          mode: 'done',
          count: this._completedCount,
          totalBytes: this._totalReceived,
        });
      }
    } catch (err) {
      this.callbacks.onError(err);
    }
  }
}
