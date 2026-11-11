import { Signaling } from './signaling.js';
import { PeerConnection } from './webrtc.js';
import { FileSender, FileReceiver } from './fileTransfer.js';
import { renderQrCode, QrScanner } from './qr.js';
import { sanitizeCodeInput, isCompleteCode, formatCodeForDisplay } from './codeUtils.js';
import { el, showPanel, showReceiveSubTab, setLinkState, setProgress, formatBytes } from './ui.js';
import { getFilesFromDataTransfer, getFilesFromInput, getFilesFromDirectoryPicker } from './fileScanner.js';
import { FileTreeView } from './fileTree.js';
import { acquireWakeLock, releaseWakeLock } from './wakeLock.js';

// ---------------------------------------------------------------- Tabs --
el.tabSend.addEventListener('click', () => showPanel('send'));
el.tabReceive.addEventListener('click', () => showPanel('receive'));
el.receiveSubTabScan.addEventListener('click', () => showReceiveSubTab('scan'));
el.receiveSubTabType.addEventListener('click', () => showReceiveSubTab('type'));

// ================================================================ SEND ==
let sendSignaling = null;
let sendPeer = null;
let currentSendFiles = [];
let senderTreeView = null;
let fileSenderInstance = null;

// File & Folder pickers
el.btnPickFiles?.addEventListener('click', (e) => {
  e.preventDefault();
  el.fileInput.click();
});

el.btnPickFolder?.addEventListener('click', async (e) => {
  e.preventDefault();
  if ('showDirectoryPicker' in window) {
    try {
      const files = await getFilesFromDirectoryPicker();
      if (files && files.length > 0) {
        beginSend(files);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('DirectoryPicker error, falling back to input:', err);
        el.folderInput.click();
      }
    }
  } else {
    el.folderInput.click();
  }
});

el.dropzone.addEventListener('click', (e) => {
  // Clicking the dropzone area triggers file picker
  el.fileInput.click();
});

el.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropzone.classList.add('is-dragover');
});

el.dropzone.addEventListener('dragleave', () => {
  el.dropzone.classList.remove('is-dragover');
});

el.dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('is-dragover');
  const files = await getFilesFromDataTransfer(e.dataTransfer);
  if (files.length > 0) {
    beginSend(files);
  }
});

el.fileInput.addEventListener('change', () => {
  const files = getFilesFromInput(el.fileInput);
  if (files.length > 0) {
    beginSend(files);
  }
});

el.folderInput.addEventListener('change', () => {
  const files = getFilesFromInput(el.folderInput);
  if (files.length > 0) {
    beginSend(files);
  }
});

// Copy Shareable Link
el.copyLinkBtn.addEventListener('click', async () => {
  if (el.shareLinkInput.value) {
    try {
      await navigator.clipboard.writeText(el.shareLinkInput.value);
      const originalText = el.copyLinkBtn.textContent;
      el.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        el.copyLinkBtn.textContent = originalText;
      }, 2000);
    } catch {
      el.shareLinkInput.select();
    }
  }
});

// Reset / Start New Transfer
el.btnNewSend.addEventListener('click', resetSendState);

async function beginSend(files) {
  resetSendState();
  currentSendFiles = files;

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);
  el.sendFileInfo.textContent = `${files.length} item${files.length > 1 ? 's' : ''} staged (${formatBytes(totalSize)})`;

  // Render tree view in staging area (read-only for sender)
  el.sendStaging.hidden = false;
  senderTreeView = new FileTreeView(el.sendFileTree, files, { selectable: false });

  el.codeBox.hidden = true;
  el.sendProgress.hidden = true;
  el.sendDone.hidden = true;
  el.btnNewSend.hidden = true;
  setLinkState(el.sendLinkVisual, 'idle');
  el.sendStatus.textContent = 'Requesting a share code…';

  try {
    await acquireWakeLock();

    sendSignaling = new Signaling();
    await sendSignaling.connect();

    sendSignaling.on('room-created', ({ code }) => {
      el.codeText.textContent = formatCodeForDisplay(code);
      const shareUrl = `${window.location.origin}${window.location.pathname}#${code}`;
      el.shareLinkInput.value = shareUrl;
      el.codeBox.hidden = false;
      renderQrCode(el.qrCanvas, code);
      setLinkState(el.sendLinkVisual, 'waiting');
      el.sendStatus.textContent = 'Waiting for receiver to connect…';
    });

    sendSignaling.on('receiver-joined', async () => {
      el.sendStatus.textContent = 'Receiver connected. Establishing direct connection…';
      sendPeer = new PeerConnection(sendSignaling, 'sender');

      sendPeer.onChannelOpen = (channel) => {
        setLinkState(el.sendLinkVisual, 'connected');
        el.sendStatus.textContent = 'Connected. Waiting for receiver to accept files…';

        fileSenderInstance = new FileSender(channel || sendPeer.channel, currentSendFiles, {
          onManifestSent: () => {
            el.sendStatus.textContent = 'File list sent. Waiting for receiver selection…';
          },
          onFileStart: (fileEntry, index, total) => {
            el.sendProgress.hidden = false;
            el.sendCurrentFileLabel.textContent = `Sending ${index}/${total}: ${fileEntry.name}`;
            senderTreeView?.updateFileStatus(fileEntry.id, 'Sending…', 'transferring');
          },
          onFileProgress: (fileId, sent, total) => {
            // Updated per-file
          },
          onTotalProgress: (sent, total) => {
            setProgress(el.sendProgressBar, el.sendProgressLabel, sent, total);
          },
          onFileComplete: (fileEntry) => {
            senderTreeView?.updateFileStatus(fileEntry.id, 'Sent ✅', 'complete');
          },
          onComplete: (result) => {
            releaseWakeLock();
            el.sendProgress.hidden = true;
            el.sendDone.hidden = false;
            el.btnNewSend.hidden = false;

            if (result.cancelled) {
              el.sendStatus.textContent = result.message || 'Transfer cancelled.';
            } else {
              el.sendStatus.textContent = `Transfer complete: ${result.count} file(s) sent (${formatBytes(result.totalBytes)}).`;
            }
          },
          onError: (err) => {
            releaseWakeLock();
            el.sendStatus.textContent = `Transfer failed: ${err.message || err}`;
            el.btnNewSend.hidden = false;
          },
        });

        sendPeer.onMessage = (data) => fileSenderInstance.handleMessage(data);
        fileSenderInstance.start();
      };

      sendPeer.onChannelClose = () => {
        setLinkState(el.sendLinkVisual, 'idle');
        releaseWakeLock();
      };

      await sendPeer.createOffer();
    });

    sendSignaling.on('error', ({ message }) => {
      releaseWakeLock();
      el.sendStatus.textContent = message;
      el.btnNewSend.hidden = false;
    });

    sendSignaling.createRoom();
  } catch (err) {
    releaseWakeLock();
    el.sendStatus.textContent = `Connection error: ${err.message || err}`;
    el.btnNewSend.hidden = false;
  }
}

function resetSendState() {
  releaseWakeLock();
  fileSenderInstance?.cancel();
  fileSenderInstance = null;

  if (sendPeer) {
    sendPeer.close();
    sendPeer = null;
  }
  if (sendSignaling) {
    sendSignaling.ws?.close();
    sendSignaling = null;
  }

  currentSendFiles = [];
  senderTreeView = null;

  el.fileInput.value = '';
  el.folderInput.value = '';
  el.sendFileInfo.textContent = '';
  el.sendFileTree.innerHTML = '';
  el.sendStaging.hidden = true;
  el.codeBox.hidden = true;
  el.sendProgress.hidden = true;
  el.sendProgressBar.style.width = '0%';
  el.sendProgressLabel.textContent = '';
  el.sendDone.hidden = true;
  el.btnNewSend.hidden = true;
  setLinkState(el.sendLinkVisual, 'idle');
  el.sendStatus.textContent = '';
}

// ============================================================= RECEIVE ==
let receiveSignaling = null;
let receivePeer = null;
let scanner = null;
let receiverTreeView = null;
let fileReceiverInstance = null;

el.codeInput.addEventListener('input', () => {
  el.codeInput.value = sanitizeCodeInput(el.codeInput.value);
  el.connectBtn.disabled = !isCompleteCode(el.codeInput.value);
});

el.connectBtn.addEventListener('click', () => connectToRoom(el.codeInput.value));

el.startScanBtn.addEventListener('click', async () => {
  try {
    scanner = new QrScanner(el.qrVideo, el.qrScanCanvas, (code) => {
      connectToRoom(sanitizeCodeInput(code));
    });
    await scanner.start();
    el.startScanBtn.textContent = 'Scanning…';
  } catch (err) {
    el.receiveStatus.textContent = `Camera unavailable: ${err.message || err}`;
  }
});

// Select All / Deselect All
el.btnSelectAll?.addEventListener('click', () => receiverTreeView?.selectAll());
el.btnDeselectAll?.addEventListener('click', () => receiverTreeView?.deselectAll());

// Reset / Receive More Files
el.btnNewReceive?.addEventListener('click', resetReceiveState);

async function connectToRoom(code) {
  if (!isCompleteCode(code)) return;
  resetReceiveState();

  scanner?.stop();
  el.startScanBtn.textContent = 'Start camera';

  setLinkState(el.receiveLinkVisual, 'waiting');
  el.receiveStatus.textContent = 'Connecting…';

  try {
    await acquireWakeLock();

    receiveSignaling = new Signaling();
    await receiveSignaling.connect();

    receiveSignaling.on('room-joined', () => {
      el.receiveStatus.textContent = 'Joined room. Establishing direct connection…';
      receivePeer = new PeerConnection(receiveSignaling, 'receiver');

      // Use a getter () => receivePeer?.channel so channel access is always dynamic and safe
      fileReceiverInstance = new FileReceiver(() => receivePeer?.channel, {
        onManifest: (manifest, capabilities) => {
          el.receiveStatus.textContent = 'File list received. Select files to download:';
          el.receiveManifestBox.hidden = false;

          // Render interactive checklist with folder and file controls
          receiverTreeView = new FileTreeView(el.receiveFileTree, manifest.files, {
            selectable: true,
            onSelectionChange: (selectedIds, totalBytes) => {
              el.receiveManifestSummary.textContent = `${selectedIds.length} of ${manifest.files.length} selected (${formatBytes(totalBytes)})`;
              el.receiveConfirmBtn.disabled = selectedIds.length === 0;
              el.receiveConfirmBtn.textContent = `Download Selected (${formatBytes(totalBytes)})`;
            },
          });

          // Explain storage destination based on browser support
          if (capabilities.supportsDirectoryPicker) {
            el.receiveMethodNote.textContent = '⚡ Direct-to-disk enabled: Click below to choose where to save files directly.';
          } else {
            el.receiveMethodNote.textContent = '📦 Browser archive: Files will be downloaded as a single ZIP file.';
          }

          el.receiveConfirmBtn.onclick = async () => {
            const selectedIds = receiverTreeView.getSelectedIds();
            if (selectedIds.length === 0) return;

            el.receiveConfirmBtn.disabled = true;
            el.receiveManifestBox.hidden = true;
            el.receiveProgress.hidden = false;
            el.receiveStatus.textContent = 'Starting download…';

            await fileReceiverInstance.acceptManifest(selectedIds);
          };
        },

        onFileStart: (fileMeta) => {
          el.receiveCurrentFileLabel.textContent = `Receiving ${fileMeta.index}/${fileMeta.total}: ${fileMeta.name}`;
          receiverTreeView?.updateFileStatus(fileMeta.id, 'Downloading…', 'transferring');
        },

        onFileProgress: (fileId, recv, total) => {
          // Updated per file
        },

        onTotalProgress: (recv, total) => {
          setProgress(el.receiveProgressBar, el.receiveProgressLabel, recv, total);
        },

        onFileComplete: (fileMeta) => {
          receiverTreeView?.updateFileStatus(fileMeta.id, 'Received ✅', 'complete');
        },

        onComplete: (result) => {
          releaseWakeLock();
          el.receiveProgress.hidden = true;
          el.receiveDone.hidden = false;
          el.btnNewReceive.hidden = false;
          el.receiveStatus.textContent = 'Transfer complete!';

          if (result.mode === 'directory') {
            el.receiveDoneMessage.textContent = `All ${result.count} files saved directly to your chosen folder ✅`;
            el.downloadLink.hidden = true;
          } else if (result.mode === 'single-stream') {
            el.receiveDoneMessage.textContent = 'File saved directly to disk ✅';
            el.downloadLink.hidden = true;
          } else if (result.mode === 'zip') {
            el.receiveDoneMessage.textContent = `All ${result.count} files bundled into ZIP archive.`;
            el.downloadLink.href = result.url;
            el.downloadLink.download = result.name || 'relay-files.zip';
            el.downloadLink.hidden = false;
            el.downloadLink.textContent = `Save ${result.name} (${formatBytes(result.totalBytes)})`;
            // Trigger download prompt automatically
            el.downloadLink.click();
          } else {
            el.receiveDoneMessage.textContent = `All ${result.count} files received successfully.`;
            el.downloadLink.hidden = true;
          }
        },

        onError: (err) => {
          releaseWakeLock();
          el.receiveStatus.textContent = `Transfer failed: ${err.message || err}`;
          el.btnNewReceive.hidden = false;
        },
      });

      receivePeer.onChannelOpen = (channel) => {
        if (fileReceiverInstance) {
          fileReceiverInstance.channel = channel;
        }
        setLinkState(el.receiveLinkVisual, 'connected');
      };

      receivePeer.onChannelClose = () => {
        setLinkState(el.receiveLinkVisual, 'idle');
        releaseWakeLock();
      };

      receivePeer.onMessage = (data) => fileReceiverInstance.handleMessage(data);
    });

    receiveSignaling.on('error', ({ message }) => {
      releaseWakeLock();
      el.receiveStatus.textContent = message;
      setLinkState(el.receiveLinkVisual, 'idle');
      el.btnNewReceive.hidden = false;
    });

    receiveSignaling.joinRoom(code);
  } catch (err) {
    releaseWakeLock();
    el.receiveStatus.textContent = `Connection error: ${err.message || err}`;
    el.btnNewReceive.hidden = false;
  }
}

function resetReceiveState() {
  releaseWakeLock();
  scanner?.stop();

  if (receivePeer) {
    receivePeer.close();
    receivePeer = null;
  }
  if (receiveSignaling) {
    receiveSignaling.ws?.close();
    receiveSignaling = null;
  }

  receiverTreeView = null;
  fileReceiverInstance = null;

  el.receiveManifestBox.hidden = true;
  el.receiveFileTree.innerHTML = '';
  el.receiveProgress.hidden = true;
  el.receiveProgressBar.style.width = '0%';
  el.receiveProgressLabel.textContent = '';
  el.receiveDone.hidden = true;
  el.downloadLink.hidden = true;
  el.btnNewReceive.hidden = true;
  el.codeInput.value = '';
  el.connectBtn.disabled = true;

  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname);
  }

  setLinkState(el.receiveLinkVisual, 'idle');
  el.receiveStatus.textContent = '';
}

// -------------------------------------------------------- Auto-Join Hash --
// If URL has #CODE, switch to Receive and connect immediately
window.addEventListener('DOMContentLoaded', () => {
  const hash = (window.location.hash || '').replace('#', '').trim().toUpperCase();
  if (isCompleteCode(hash)) {
    showPanel('receive');
    showReceiveSubTab('type');
    el.codeInput.value = hash;
    el.connectBtn.disabled = false;
    connectToRoom(hash);
  }
});
