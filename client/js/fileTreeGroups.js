/**
 * Groups a list of image files by their folder path for the Gallery View.
 *
 * @param {Array} imageFiles
 * @returns {Array<{ path: string, name: string, files: Array, allFileIds: Array }>}
 */
export function groupImagesByFolder(imageFiles) {
  const groups = new Map(); // path -> group

  for (const file of imageFiles) {
    const parts = file.path.split('/').filter(Boolean);
    let folderPath = '';
    let folderName = 'Loose Images';

    if (parts.length > 1) {
      parts.pop(); // remove file name itself
      folderPath = parts.join('/');
      folderName = folderPath;
    }

    if (!groups.has(folderPath)) {
      groups.set(folderPath, {
        path: folderPath,
        name: folderName,
        files: [],
        allFileIds: [],
      });
    }

    const group = groups.get(folderPath);
    group.files.push(file);
    group.allFileIds.push(file.id);
  }

  return Array.from(groups.values());
}

