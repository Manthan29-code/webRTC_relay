const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export const el = {
  tabSend: getEl('tab-send'),
  tabReceive: getEl('tab-receive'),
  panelSend: getEl('panel-send'),
  panelReceive: getEl('panel-receive'),

  // Send panel elements
  dropzone: getEl('dropzone'),
  fileInput: getEl('file-input'),
  folderInput: getEl('folder-input'),
  btnPickFiles: getEl('btn-pick-files'),
  btnPickFolder: getEl('btn-pick-folder'),
  sendFileInfo: getEl('send-file-info'),

  sendStaging: getEl('send-staging'),
  sendFileTree: getEl('send-file-tree'),

  codeBox: getEl('code-box'),
  codeText: getEl('code-text'),
  shareLinkWrapper: getEl('share-link-wrapper'),
  shareLinkInput: getEl('share-link-input'),
  copyLinkBtn: getEl('copy-link-btn'),
  qrCanvas: getEl('qr-canvas'),

  sendLinkVisual: getEl('send-link-visual'),
  sendStatus: getEl('send-status'),

  sendProgress: getEl('send-progress'),
  sendCurrentFileLabel: getEl('send-current-file-label'),
  sendProgressBar: getEl('send-progress-bar'),
  sendProgressLabel: getEl('send-progress-label'),
  sendDone: getEl('send-done'),
  btnNewSend: getEl('btn-new-send'),

  // Receive panel elements
  receiveSubTabScan: getEl('subtab-scan'),
  receiveSubTabType: getEl('subtab-type'),
  scanPane: getEl('scan-pane'),
  typePane: getEl('type-pane'),
  qrVideo: getEl('qr-video'),
  qrScanCanvas: getEl('qr-scan-canvas'),
  startScanBtn: getEl('start-scan-btn'),
  codeInput: getEl('code-input'),
  connectBtn: getEl('connect-btn'),

  receiveLinkVisual: getEl('receive-link-visual'),
  receiveStatus: getEl('receive-status'),

  receiveManifestBox: getEl('receive-manifest-box'),
  receiveManifestSummary: getEl('receive-manifest-summary'),
  btnSelectAll: getEl('btn-select-all'),
  btnDeselectAll: getEl('btn-deselect-all'),
  receiveFileTree: getEl('receive-file-tree'),
  receiveConfirmBtn: getEl('receive-confirm-btn'),
  receiveMethodNote: getEl('receive-method-note'),

  receiveProgress: getEl('receive-progress'),
  receiveCurrentFileLabel: getEl('receive-current-file-label'),
  receiveProgressBar: getEl('receive-progress-bar'),
  receiveProgressLabel: getEl('receive-progress-label'),
  receiveDone: getEl('receive-done'),
  receiveDoneMessage: getEl('receive-done-message'),
  downloadLink: getEl('download-link'),
  btnNewReceive: getEl('btn-new-receive'),
};

export function showPanel(name) {
  const isSend = name === 'send';
  el.panelSend?.classList.toggle('is-active', isSend);
  el.panelReceive?.classList.toggle('is-active', !isSend);
  el.tabSend?.classList.toggle('is-active', isSend);
  el.tabReceive?.classList.toggle('is-active', !isSend);
}

export function showReceiveSubTab(name) {
  const isScan = name === 'scan';
  el.scanPane?.classList.toggle('is-active', isScan);
  el.typePane?.classList.toggle('is-active', !isScan);
  el.receiveSubTabScan?.classList.toggle('is-active', isScan);
  el.receiveSubTabType?.classList.toggle('is-active', !isScan);
}

/** Drives the shared "link" signature visual: idle -> waiting -> connected. */
export function setLinkState(visualEl, state) {
  if (visualEl) {
    visualEl.dataset.state = state; // 'idle' | 'waiting' | 'connected'
  }
}

export function setProgress(barEl, labelEl, sent, total, extraPrefix = '') {
  const pct = total > 0 ? Math.min(100, (sent / total) * 100) : 0;
  if (barEl) barEl.style.width = `${pct.toFixed(1)}%`;
  const prefix = extraPrefix ? `${extraPrefix} • ` : '';
  if (labelEl) labelEl.textContent = `${prefix}${formatBytes(sent)} / ${formatBytes(total)} (${pct.toFixed(0)}%)`;
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
