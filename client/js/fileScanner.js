import { isImageFile, isVideoFile, isMediaFile } from './imageUtils.js';

/**
 * Utilities for extracting, recursively scanning, and normalizing files
 * from Drag & Drop events, Directory Pickers, and File Inputs.
 */

/**
 * Extracts files directly from modern Chromium's window.showDirectoryPicker().
 * Provides the native OS "Select Folder" dialog.
 *
 * @returns {Promise<Array<{ id: number, file: File, name: string, path: string, size: number, mime: string }> | null>}
 */
export async function getFilesFromDirectoryPicker() {
  if (!('showDirectoryPicker' in window)) {
    return null;
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  const rawList = await scanDirectoryHandle(dirHandle, '');
  return normalizeFileList(rawList);
}

async function scanDirectoryHandle(dirHandle, parentPath) {
  const currentPath = parentPath ? `${parentPath}/${dirHandle.name}` : dirHandle.name;
  const results = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      results.push({
        file,
        path: `${currentPath}/${file.name}`,
      });
    } else if (entry.kind === 'directory') {
      const nested = await scanDirectoryHandle(entry, currentPath);
      results.push(...nested);
    }
  }

  return results;
}

/**
 * Extracts all files from a Drag & Drop DataTransfer object,
 * recursively traversing any dropped folders and subfolders.
 *
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<Array<{ id: number, file: File, name: string, path: string, size: number, mime: string }>>}
 */
export async function getFilesFromDataTransfer(dataTransfer) {
  const items = dataTransfer.items;
  const rawList = [];

  if (items && items.length > 0) {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (entry) {
        entries.push(entry);
      }
    }

    if (entries.length > 0) {
      for (const entry of entries) {
        const scanned = await scanEntry(entry, '');
        rawList.push(...scanned);
      }
    }
  }

  // Fallback to standard files list if items/webkitGetAsEntry was unavailable or yielded nothing
  if (rawList.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const file = dataTransfer.files[i];
      rawList.push({
        file,
        path: file.webkitRelativePath || file.name,
      });
    }
  }

  return normalizeFileList(rawList);
}

/**
 * Recursively scans a FileSystemEntry (file or directory).
 * Uses batch reading to ensure directories with >100 entries are fully loaded.
 */
async function scanEntry(entry, parentPath) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        (file) => {
          const path = parentPath ? `${parentPath}/${file.name}` : file.name;
          resolve([{ file, path }]);
        },
        () => resolve([])
      );
    });
  }

  if (entry.isDirectory) {
    const dirPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const dirReader = entry.createReader();
    const collectedFiles = [];

    const readBatch = () => {
      return new Promise((resolve) => {
        dirReader.readEntries(
          async (entries) => {
            if (!entries || entries.length === 0) {
              resolve();
            } else {
              for (const childEntry of entries) {
                const childFiles = await scanEntry(childEntry, dirPath);
                collectedFiles.push(...childFiles);
              }
              await readBatch();
              resolve();
            }
          },
          () => resolve()
        );
      });
    };

    await readBatch();
    return collectedFiles;
  }

  return [];
}

/**
 * Normalizes a FileList from `<input type="file">` or `<input webkitdirectory>`.
 */
export function getFilesFromInput(inputElement) {
  const files = Array.from(inputElement.files || []);
  const rawList = files.map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
  return normalizeFileList(rawList);
}

/**
 * Assigns stable IDs and standardized properties to each file entry.
 */
function normalizeFileList(rawList) {
  return rawList.map((item, index) => ({
    id: index,
    file: item.file,
    name: item.file.name,
    path: sanitizePath(item.path || item.file.name),
    size: item.file.size,
    mime: item.file.type || 'application/octet-stream',
    isImage: isImageFile(item.file.name, item.file.type),
    isVideo: isVideoFile(item.file.name, item.file.type),
    isMedia: isMediaFile(item.file.name, item.file.type),
  }));
}

/**
 * Normalizes path slashes to forward slashes and removes leading/trailing slashes.
 */
function sanitizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
