import { Signaling } from './signaling.js';
import { PeerConnection } from './webrtc.js';
import { FileSender, FileReceiver } from './fileTransfer.js';
import { renderQrCode, QrScanner } from './qr.js';
import { sanitizeCodeInput, isCompleteCode, formatCodeForDisplay } from './codeUtils.js';
import { el, showPanel, showReceiveSubTab, setLinkState, setProgress, formatBytes } from './ui.js';

// ---------------------------------------------------------------- Tabs --
el.tabSend.addEventListener('click', () => showPanel('send'));
el.tabReceive.addEventListener('click', () => showPanel('receive'));
el.receiveSubTabScan.addEventListener('click', () => showReceiveSubTab('scan'));
el.receiveSubTabType.addEventListener('click', () => showReceiveSubTab('type'));

// ================================================================ SEND ==
let sendPeer = null;

el.dropzone.addEventListener('click', () => el.fileInput.click());
el.dropzone.addEventListener('dragover', (e) => { e.preventDefault(); el.dropzone.classList.add('is-dragover'); });
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('is-dragover'));
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('is-dragover');
  const file = e.dataTransfer.files[0];
  if (file) beginSend(file);
});
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files[0];
  if (file) beginSend(file);
});

async function beginSend(file) {
  el.sendFileInfo.textContent = `${file.name} — ${formatBytes(file.size)}`;
  el.codeBox.hidden = true;
  el.sendProgress.hidden = true;
  setLinkState(el.sendLinkVisual, 'idle');
  el.sendStatus.textContent = 'Requesting a share code…';

  const signaling = new Signaling();
  await signaling.connect();

  signaling.on('room-created', ({ code }) => {
    el.codeText.textContent = formatCodeForDisplay(code);
    el.codeBox.hidden = false;
    renderQrCode(el.qrCanvas, code);
    setLinkState(el.sendLinkVisual, 'waiting');
    el.sendStatus.textContent = 'Waiting for the receiver to connect…';
  });

  signaling.on('receiver-joined', async () => {
    el.sendStatus.textContent = 'Receiver found. Establishing a direct connection…';
    sendPeer = new PeerConnection(signaling, 'sender');

    sendPeer.onChannelOpen = () => {
      setLinkState(el.sendLinkVisual, 'connected');
      el.sendStatus.textContent = 'Connected. Sending file…';
      el.sendProgress.hidden = false;

      const sender = new FileSender(sendPeer.channel, file, {
        onProgress: (sent, total) => setProgress(el.sendProgressBar, el.sendProgressLabel, sent, total),
        onComplete: () => { el.sendStatus.textContent = 'File sent successfully.'; },
        onError: (err) => { el.sendStatus.textContent = `Transfer failed: ${err.message || err}`; },
      });
      sendPeer.onMessage = (data) => sender.handleMessage(data);
      sender.start();
    };

    sendPeer.onChannelClose = () => setLinkState(el.sendLinkVisual, 'idle');
    await sendPeer.createOffer();
  });

  signaling.on('error', ({ message }) => { el.sendStatus.textContent = message; });
  signaling.createRoom();
}

// ============================================================= RECEIVE ==
let receivePeer = null;
let scanner = null;

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

async function connectToRoom(code) {
  if (!isCompleteCode(code)) return;
  scanner?.stop();
  setLinkState(el.receiveLinkVisual, 'waiting');
  el.receiveStatus.textContent = 'Connecting…';

  const signaling = new Signaling();
  await signaling.connect();

  signaling.on('room-joined', () => {
    el.receiveStatus.textContent = 'Joined. Establishing a direct connection…';
    receivePeer = new PeerConnection(signaling, 'receiver');

    const receiver = new FileReceiver(receivePeer.channel, {
      onMeta: (meta, { supportsUnlimitedSize }) => {
        el.receiveFileInfo.textContent = `${meta.name} — ${formatBytes(meta.size)}`;
        el.saveAsBtn.hidden = false;
        el.saveAsBtn.textContent = supportsUnlimitedSize
          ? 'Choose where to save…'
          : 'Receive (kept in browser memory)';
        el.saveAsBtn.onclick = () => {
          el.saveAsBtn.hidden = true;
          el.receiveProgress.hidden = false;
          receiver.prepareDestination();
        };
      },
      onProgress: (recv, total) => setProgress(el.receiveProgressBar, el.receiveProgressLabel, recv, total),
      onComplete: (result) => {
        el.receiveStatus.textContent = 'Transfer complete.';
        el.receiveDone.hidden = false;
        if (result.mode === 'blob') {
          el.downloadLink.href = result.url;
          el.downloadLink.download = result.name;
          el.downloadLink.hidden = false;
        } else {
          el.downloadLink.hidden = true;
        }
      },
      onError: (err) => { el.receiveStatus.textContent = `Transfer failed: ${err.message || err}`; },
    });

    receivePeer.onChannelOpen = () => setLinkState(el.receiveLinkVisual, 'connected');
    receivePeer.onChannelClose = () => setLinkState(el.receiveLinkVisual, 'idle');
    receivePeer.onMessage = (data) => receiver.handleMessage(data);
  });

  signaling.on('error', ({ message }) => {
    el.receiveStatus.textContent = message;
    setLinkState(el.receiveLinkVisual, 'idle');
  });

  signaling.joinRoom(code);
}
