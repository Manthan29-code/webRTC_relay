/**
 * Builds, renders, and manages interactive hierarchical file & folder trees
 * as well as a dedicated Image Gallery view with folder-level select,
 * individual image select, responsive 2-column mobile grids, and real-time status.
 */
import { formatBytes } from './ui.js';
import { groupImagesByFolder } from './fileTreeGroups.js';

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

    this.mediaFiles = files.filter((f) => f.isMedia || f.isImage || f.isVideo);
    this.imageFiles = this.mediaFiles;
    this.imageGroups = groupImagesByFolder(this.mediaFiles);

    this.selectedIds = new Set(files.map((f) => f.id));
    this.tree = buildFileTree(files);

    this._folderMap = new Map(); // path -> folderNode in tree
    this._collectFolders(this.tree);

    this._galleryFolderMap = new Map(); // path -> imageGroup
    for (const group of this.imageGroups) {
      this._galleryFolderMap.set(group.path, group);
    }

    this._thumbCache = new Map(); // fileId -> dataUrl
    // Pre-cache any existing thumbnail urls (e.g. sender object URLs)
    for (const f of files) {
      if (f.thumb) this._thumbCache.set(f.id, f.thumb);
      if (f.thumbData) this._thumbCache.set(f.id, f.thumbData);
    }

    this.activeView = 'tree'; // 'tree' | 'gallery'

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

    // 1. Render View Switcher if there are images in this batch
    if (this.imageFiles.length > 0) {
      const switcher = document.createElement('div');
      switcher.className = 'view-switcher-bar';
      switcher.innerHTML = `
        <button type="button" class="view-switch-btn ${this.activeView === 'tree' ? 'is-active' : ''}" data-view="tree">
          <span>📋 All Files</span>
          <span class="view-badge-count">(${this.files.length})</span>
        </button>
        <button type="button" class="view-switch-btn ${this.activeView === 'gallery' ? 'is-active' : ''}" data-view="gallery">
          <span>🖼️ Media</span>
          <span class="view-badge-count">(${this.mediaFiles.length})</span>
        </button>
      `;
      wrapper.appendChild(switcher);

      switcher.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-switch-btn');
        if (!btn) return;
        const targetView = btn.dataset.view;
        if (targetView === this.activeView) return;

        this.activeView = targetView;
        switcher.querySelectorAll('.view-switch-btn').forEach((b) => {
          b.classList.toggle('is-active', b.dataset.view === targetView);
        });

        this.treeWrapper.hidden = targetView !== 'tree';
        this.galleryWrapper.hidden = targetView !== 'gallery';
      });
    }

    // 2. Render List / Tree View (shows all files and folders)
    this.treeWrapper = document.createElement('div');
    this.treeWrapper.className = 'tree-view-wrapper file-tree-container';
    this.treeWrapper.hidden = this.activeView !== 'tree';
    this._renderNodeChildren(this.tree, this.treeWrapper);
    wrapper.appendChild(this.treeWrapper);

    // 3. Render Gallery View (only images grouped by folder)
    if (this.imageFiles.length > 0) {
      this.galleryWrapper = document.createElement('div');
      this.galleryWrapper.className = 'gallery-view-wrapper gallery-view-container';
      this.galleryWrapper.hidden = this.activeView !== 'gallery';
      this._renderGallery(this.galleryWrapper);
      wrapper.appendChild(this.galleryWrapper);
    }

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

      const fileIcon = file.isImage ? '🖼️' : '📄';

      fileEl.innerHTML = `
        <label class="tree-label file-label">
          ${checkboxHtml}
          <span class="tree-icon">${fileIcon}</span>
          <span class="tree-name file-title" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</span>
        </label>
        <span class="tree-size">${formatBytes(file.size)}</span>
        <span class="tree-status-badge badge-pending" data-status-id="${file.id}">Pending</span>
      `;
      parentEl.appendChild(fileEl);
    }
  }

  _renderGallery(parentEl) {
    parentEl.innerHTML = '';

    for (const group of this.imageGroups) {
      const section = document.createElement('div');
      section.className = 'gallery-folder-section';

      let folderCheckboxHtml = '';
      if (this.options.selectable) {
        folderCheckboxHtml = `<input type="checkbox" class="gallery-folder-checkbox" data-folder-path="${escapeHtml(group.path)}" checked />`;
      }

      const header = document.createElement('div');
      header.className = 'gallery-folder-header';
      header.innerHTML = `
        <label class="gallery-folder-label">
          ${folderCheckboxHtml}
          <span class="gallery-folder-icon">📁</span>
          <span class="gallery-folder-title">${escapeHtml(group.name)}</span>
          <span class="gallery-folder-count">(${group.files.length} image${group.files.length > 1 ? 's' : ''})</span>
        </label>
      `;
      section.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'image-grid';

      for (const file of group.files) {
        const card = document.createElement('div');
        card.className = `image-card ${this.selectedIds.has(file.id) ? 'is-selected' : ''}`;
        card.dataset.fileId = file.id;

        const thumbSrc = this._thumbCache.get(file.id) || '';
        const videoBadgeHtml = file.isVideo ? '<div class="video-play-badge">▶ Video</div>' : '';

        card.innerHTML = `
          <div class="image-thumb-wrapper">
            <img class="image-thumb" src="${thumbSrc}" alt="${escapeHtml(file.name)}" loading="lazy" />
            ${videoBadgeHtml}
            <div class="image-check-badge">
              <svg class="image-check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </div>
          </div>
          <div class="image-card-info">
            <span class="image-card-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
            <span class="image-card-size">${formatBytes(file.size)}</span>
          </div>
        `;

        grid.appendChild(card);
      }

      section.appendChild(grid);
      parentEl.appendChild(section);
    }
  }

  _bindSelectionEvents() {
    // 1. Tree view checkbox changes
    this.treeWrapper.addEventListener('change', (e) => {
      const target = e.target;
      if (target.classList.contains('folder-checkbox')) {
        const folderPath = target.dataset.folderPath;
        const folderNode = this._folderMap.get(folderPath);
        if (folderNode) {
          const isChecked = target.checked;
          for (const id of folderNode.allFileIds) {
            if (isChecked) this.selectedIds.add(id);
            else this.selectedIds.delete(id);
          }
          this.updateSelectionStates();
        }
      } else if (target.classList.contains('file-checkbox')) {
        const fileId = parseInt(target.dataset.fileId, 10);
        if (target.checked) this.selectedIds.add(fileId);
        else this.selectedIds.delete(fileId);
        this.updateSelectionStates();
      }
    });

    // 2. Gallery view clicks (card click toggles image, folder checkbox toggles folder)
    if (this.galleryWrapper) {
      this.galleryWrapper.addEventListener('change', (e) => {
        const target = e.target;
        if (target.classList.contains('gallery-folder-checkbox')) {
          const folderPath = target.dataset.folderPath;
          const group = this._galleryFolderMap.get(folderPath);
          if (group) {
            const isChecked = target.checked;
            for (const id of group.allFileIds) {
              if (isChecked) this.selectedIds.add(id);
              else this.selectedIds.delete(id);
            }
            this.updateSelectionStates();
          }
        }
      });

      this.galleryWrapper.addEventListener('click', (e) => {
        // If clicked on the folder checkbox, let native change event handle it
        if (e.target.classList.contains('gallery-folder-checkbox') || e.target.closest('.gallery-folder-label')) {
          return;
        }

        const card = e.target.closest('.image-card');
        if (card) {
          const fileId = parseInt(card.dataset.fileId, 10);
          if (this.selectedIds.has(fileId)) {
            this.selectedIds.delete(fileId);
          } else {
            this.selectedIds.add(fileId);
          }
          this.updateSelectionStates();
        }
      });
    }
  }

  selectAll() {
    if (this.activeView === 'gallery') {
      for (const file of this.mediaFiles) {
        this.selectedIds.add(file.id);
      }
    } else {
      for (const file of this.files) {
        this.selectedIds.add(file.id);
      }
    }
    this.updateSelectionStates();
  }

  deselectAll() {
    if (this.activeView === 'gallery') {
      for (const file of this.mediaFiles) {
        this.selectedIds.delete(file.id);
      }
    } else {
      this.selectedIds.clear();
    }
    this.updateSelectionStates();
  }

  updateSelectionStates() {
    // 1. Update tree file checkboxes
    const fileCheckboxes = this.treeWrapper.querySelectorAll('.file-checkbox');
    fileCheckboxes.forEach((cb) => {
      const id = parseInt(cb.dataset.fileId, 10);
      cb.checked = this.selectedIds.has(id);
    });

    // 2. Update tree folder checkboxes (tri-state indeterminate)
    const folderCheckboxes = this.treeWrapper.querySelectorAll('.folder-checkbox');
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

    // 3. Update gallery image cards & folder checkboxes
    if (this.galleryWrapper) {
      const cards = this.galleryWrapper.querySelectorAll('.image-card');
      cards.forEach((card) => {
        const fileId = parseInt(card.dataset.fileId, 10);
        card.classList.toggle('is-selected', this.selectedIds.has(fileId));
      });

      const galleryFolderCbs = this.galleryWrapper.querySelectorAll('.gallery-folder-checkbox');
      galleryFolderCbs.forEach((cb) => {
        const folderPath = cb.dataset.folderPath;
        const group = this._galleryFolderMap.get(folderPath);
        if (group) {
          const selectedCount = group.allFileIds.filter((id) => this.selectedIds.has(id)).length;
          const totalCount = group.allFileIds.length;

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
    }

    // 4. Compute total selected bytes & trigger listener
    const selectedBytes = this.files
      .filter((f) => this.selectedIds.has(f.id))
      .reduce((acc, f) => acc + f.size, 0);

    this.options.onSelectionChange(Array.from(this.selectedIds), selectedBytes);
  }

  setThumbnails(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.id !== undefined && item.thumb) {
        this._thumbCache.set(item.id, item.thumb);
        if (this.galleryWrapper) {
          const img = this.galleryWrapper.querySelector(`.image-card[data-file-id="${item.id}"] .image-thumb`);
          if (img) {
            img.src = item.thumb;
          }
        }
      }
    }
  }

  updateFileStatus(fileId, statusText, statusType = 'pending') {
    const badge = this.treeWrapper?.querySelector(`.tree-status-badge[data-status-id="${fileId}"]`);
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
