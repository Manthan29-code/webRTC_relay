export const el = {
  tabSend: document.getElementById('tab-send'),
  tabReceive: document.getElementById('tab-receive'),
  panelSend: document.getElementById('panel-send'),
  panelReceive: document.getElementById('panel-receive'),

  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('file-input'),
  sendFileInfo: document.getElementById('send-file-info'),
  codeBox: document.getElementById('code-box'),
  codeText: document.getElementById('code-text'),
  qrCanvas: document.getElementById('qr-canvas'),

  receiveSubTabScan: document.getElementById('subtab-scan'),
  receiveSubTabType: document.getElementById('subtab-type'),
  scanPane: document.getElementById('scan-pane'),
  typePane: document.getElementById('type-pane'),
  qrVideo: document.getElementById('qr-video'),
  qrScanCanvas: document.getElementById('qr-scan-canvas'),
  startScanBtn: document.getElementById('start-scan-btn'),
  codeInput: document.getElementById('code-input'),
  connectBtn: document.getElementById('connect-btn'),

  sendLinkVisual: document.getElementById('send-link-visual'),
  receiveLinkVisual: document.getElementById('receive-link-visual'),

  sendStatus: document.getElementById('send-status'),
  receiveStatus: document.getElementById('receive-status'),

  sendProgress: document.getElementById('send-progress'),
  sendProgressBar: document.getElementById('send-progress-bar'),
  sendProgressLabel: document.getElementById('send-progress-label'),

  receiveFileInfo: document.getElementById('receive-file-info'),
  saveAsBtn: document.getElementById('save-as-btn'),
  receiveProgress: document.getElementById('receive-progress'),
  receiveProgressBar: document.getElementById('receive-progress-bar'),
  receiveProgressLabel: document.getElementById('receive-progress-label'),
  receiveDone: document.getElementById('receive-done'),
  downloadLink: document.getElementById('download-link'),
};

export function showPanel(name) {
  const isSend = name === 'send';
  el.panelSend.classList.toggle('is-active', isSend);
  el.panelReceive.classList.toggle('is-active', !isSend);
  el.tabSend.classList.toggle('is-active', isSend);
  el.tabReceive.classList.toggle('is-active', !isSend);
}

export function showReceiveSubTab(name) {
  const isScan = name === 'scan';
  el.scanPane.classList.toggle('is-active', isScan);
  el.typePane.classList.toggle('is-active', !isScan);
  el.receiveSubTabScan.classList.toggle('is-active', isScan);
  el.receiveSubTabType.classList.toggle('is-active', !isScan);
}

/** Drives the shared "link" signature visual: idle -> waiting -> connected. */
export function setLinkState(visualEl, state) {
  visualEl.dataset.state = state; // 'idle' | 'waiting' | 'connected'
}

export function setProgress(barEl, labelEl, sent, total) {
  const pct = total > 0 ? Math.min(100, (sent / total) * 100) : 0;
  barEl.style.width = `${pct.toFixed(1)}%`;
  labelEl.textContent = `${formatBytes(sent)} / ${formatBytes(total)} (${pct.toFixed(0)}%)`;
}

export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
