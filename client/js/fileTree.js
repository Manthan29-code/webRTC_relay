/**
 * Builds, renders, and manages interactive hierarchical file & folder trees
 * with folder-level sync checkboxes, individual file checkboxes, tri-state
 * indeterminate states, and real-time status badges.
 */
import { formatBytes } from './ui.js';

export function buildFileTree(files) {
  const root = {
    name: '',
    path: '',
    isDir: true,
    folders: new Map(),
    files: [],
    allFileIds: [],
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.length <= 1) {
      root.files.push(file);
      root.allFileIds.push(file.id);
    } else {
      let current = root;
      current.allFileIds.push(file.id);
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        if (!current.folders.has(folderName)) {
          const folderPath = current.path ? `${current.path}/${folderName}` : folderName;
          current.folders.set(folderName, {
            name: folderName,
            path: folderPath,
            isDir: true,
            folders: new Map(),
            files: [],
            allFileIds: [],
          });
        }
        current = current.folders.get(folderName);
        current.allFileIds.push(file.id);
      }
      current.files.push(file);
    }
  }

  return root;
}

export class FileTreeView {
  /**
   * @param {HTMLElement} container
   * @param {Array} files
   * @param {Object} options - { selectable: boolean, onSelectionChange: Function }
   */
  constructor(container, files, options = {}) {
    this.container = container;
    this.files = files;
    this.options = {
      selectable: true,
      onSelectionChange: () => {},
      ...options,
    };

    this.selectedIds = new Set(files.map((f) => f.id));
    this.tree = buildFileTree(files);

    this._folderMap = new Map(); // path -> folderNode
    this._collectFolders(this.tree);

    this.render();
  }

  _collectFolders(node) {
    if (node.path) {
      this._folderMap.set(node.path, node);
    }
    for (const sub of node.folders.values()) {
      this._collectFolders(sub);
    }
  }

  render() {
    this.container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-view-root';

    // Render tree recursively starting from root
    this._renderNodeChildren(this.tree, wrapper);
    this.container.appendChild(wrapper);

    if (this.options.selectable) {
      this._bindSelectionEvents();
      this.updateSelectionStates();
    }
  }

  _renderNodeChildren(node, parentEl) {
    // Render subfolders first
    for (const subFolder of node.folders.values()) {
      const folderEl = document.createElement('div');
      folderEl.className = 'tree-folder-group';

      const header = document.createElement('div');
      header.className = 'tree-folder-header';

      let checkboxHtml = '';
      if (this.options.selectable) {
        checkboxHtml = `<input type="checkbox" class="tree-checkbox folder-checkbox" data-folder-path="${escapeHtml(subFolder.path)}" checked />`;
      }

      header.innerHTML = `
        <label class="tree-label">
          ${checkboxHtml}
          <span class="tree-icon">📁</span>
          <span class="tree-name folder-title" title="${escapeHtml(subFolder.path)}">${escapeHtml(subFolder.name)}</span>
          <span class="tree-meta">(${subFolder.allFileIds.length} files)</span>
        </label>
      `;
      folderEl.appendChild(header);

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-folder-children';
      this._renderNodeChildren(subFolder, childrenContainer);
      folderEl.appendChild(childrenContainer);

      parentEl.appendChild(folderEl);
    }

    // Render files directly in this node
    for (const file of node.files) {
      const fileEl = document.createElement('div');
      fileEl.className = 'tree-file-row';
      fileEl.dataset.fileId = file.id;

      let checkboxHtml = '';
      if (this.options.selectable) {
        checkboxHtml = `<input type="checkbox" class="tree-checkbox file-checkbox" data-file-id="${file.id}" checked />`;
      }

      fileEl.innerHTML = `
        <label class="tree-label file-label">
          ${checkboxHtml}
          <span class="tree-icon">📄</span>
          <span class="tree-name file-title" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</span>
        </label>
        <span class="tree-size">${formatBytes(file.size)}</span>
        <span class="tree-status-badge badge-pending" data-status-id="${file.id}">Pending</span>
      `;
      parentEl.appendChild(fileEl);
    }
  }

  _bindSelectionEvents() {
    this.container.addEventListener('change', (e) => {
      const target = e.target;
      if (target.classList.contains('folder-checkbox')) {
        const folderPath = target.dataset.folderPath;
        const folderNode = this._folderMap.get(folderPath);
        if (folderNode) {
          const isChecked = target.checked;
          for (const id of folderNode.allFileIds) {
            if (isChecked) {
              this.selectedIds.add(id);
            } else {
              this.selectedIds.delete(id);
            }
          }
          this.updateSelectionStates();
        }
      } else if (target.classList.contains('file-checkbox')) {
        const fileId = parseInt(target.dataset.fileId, 10);
        if (target.checked) {
          this.selectedIds.add(fileId);
        } else {
          this.selectedIds.delete(fileId);
        }
        this.updateSelectionStates();
      }
    });
  }

  selectAll() {
    for (const file of this.files) {
      this.selectedIds.add(file.id);
    }
    this.updateSelectionStates();
  }

  deselectAll() {
    this.selectedIds.clear();
    this.updateSelectionStates();
  }

  updateSelectionStates() {
    // Update individual file checkboxes
    const fileCheckboxes = this.container.querySelectorAll('.file-checkbox');
    fileCheckboxes.forEach((cb) => {
      const id = parseInt(cb.dataset.fileId, 10);
      cb.checked = this.selectedIds.has(id);
    });

    // Update folder checkboxes with tri-state indeterminate support
    const folderCheckboxes = this.container.querySelectorAll('.folder-checkbox');
    folderCheckboxes.forEach((cb) => {
      const folderPath = cb.dataset.folderPath;
      const folderNode = this._folderMap.get(folderPath);
      if (folderNode) {
        const selectedCount = folderNode.allFileIds.filter((id) => this.selectedIds.has(id)).length;
        const totalCount = folderNode.allFileIds.length;

        if (selectedCount === totalCount && totalCount > 0) {
          cb.checked = true;
          cb.indeterminate = false;
        } else if (selectedCount === 0) {
          cb.checked = false;
          cb.indeterminate = false;
        } else {
          cb.checked = false;
          cb.indeterminate = true;
        }
      }
    });

    // Compute total selected bytes
    const selectedBytes = this.files
      .filter((f) => this.selectedIds.has(f.id))
      .reduce((acc, f) => acc + f.size, 0);

    this.options.onSelectionChange(Array.from(this.selectedIds), selectedBytes);
  }

  updateFileStatus(fileId, statusText, statusType = 'pending') {
    const badge = this.container.querySelector(`.tree-status-badge[data-status-id="${fileId}"]`);
    if (badge) {
      badge.textContent = statusText;
      badge.className = `tree-status-badge badge-${statusType}`;
    }
  }

  getSelectedIds() {
    return Array.from(this.selectedIds);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

