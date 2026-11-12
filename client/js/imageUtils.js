/**
 * Media helper utilities for image and video detection and compact thumbnail generation.
 */

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'avif', 'ico', 'heic', 'heif'
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', '3gp', 'ogv'
]);

export function isImageFile(filename, mime = '') {
  if (mime && mime.startsWith('image/')) return true;
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isVideoFile(filename, mime = '') {
  if (mime && mime.startsWith('video/')) return true;
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

export function isMediaFile(filename, mime = '') {
  return isImageFile(filename, mime) || isVideoFile(filename, mime);
}

/**
 * Generates a compact JPEG thumbnail (Data URL) from an image File.
 * Typically produces a 2 KB - 5 KB thumbnail string suitable for fast P2P preview streaming.
 */
export async function generateImageThumbnail(file, maxDim = 180) {
  try {
    let bitmap;
    if ('createImageBitmap' in window) {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Image failed to load'));
        };
        img.src = url;
      });
    }

    const { width, height } = bitmap;
    if (!width || !height) return null;

    let targetWidth = width;
    let targetHeight = height;

    if (width > height) {
      if (width > maxDim) {
        targetHeight = Math.round((height * maxDim) / width);
        targetWidth = maxDim;
      }
    } else {
      if (height > maxDim) {
        targetWidth = Math.round((width * maxDim) / height);
        targetHeight = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    if (bitmap.close) bitmap.close();

    return canvas.toDataURL('image/jpeg', 0.55);
  } catch (err) {
    console.warn('Could not generate image thumbnail for', file.name, err);
    return null;
  }
}

/**
 * Generates a compact JPEG thumbnail from a video File by capturing a frame at 1 sec.
 */
export async function generateVideoThumbnail(file, maxDim = 180) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    let resolved = false;
    const cleanUp = () => {
      if (!resolved) {
        resolved = true;
        URL.revokeObjectURL(url);
        video.removeAttribute('src');
        video.load();
      }
    };

    video.onloadeddata = () => {
      // Seek to 1 second (or halfway if very short) to capture a meaningful frame
      const seekTime = Math.min(1.0, (video.duration || 1) / 2);
      video.currentTime = seekTime;
    };

    video.onseeked = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
          cleanUp();
          return resolve(null);
        }

        let targetWidth = width;
        let targetHeight = height;
        if (width > height) {
          if (width > maxDim) {
            targetHeight = Math.round((height * maxDim) / width);
            targetWidth = maxDim;
          }
        } else {
          if (height > maxDim) {
            targetWidth = Math.round((width * maxDim) / height);
            targetHeight = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
        cleanUp();
        resolve(dataUrl);
      } catch {
        cleanUp();
        resolve(null);
      }
    };

    video.onerror = () => {
      cleanUp();
      resolve(null);
    };

    // 3.5s timeout guard in case video cannot be decoded
    setTimeout(() => {
      cleanUp();
      resolve(null);
    }, 3500);
  });
}

/**
 * Generates a thumbnail for any supported media file (image or video).
 */
export async function generateThumbnail(file, maxDim = 180) {
  if (isImageFile(file.name, file.type)) {
    return generateImageThumbnail(file, maxDim);
  }
  if (isVideoFile(file.name, file.type)) {
    return generateVideoThumbnail(file, maxDim);
  }
  return null;
}
