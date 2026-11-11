/**
 * Screen Wake Lock API wrapper.
 * Prevents mobile devices and laptops from sleeping mid-transfer.
 * Automatically re-acquires the lock if the user tabs away and returns.
 */
let wakeLockSentinel = null;
let isRequested = false;

export async function acquireWakeLock() {
  isRequested = true;
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (err) {
      console.warn('Wake Lock request warning:', err);
    }
  }
}

export function releaseWakeLock() {
  isRequested = false;
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (isRequested && document.visibilityState === 'visible' && !wakeLockSentinel) {
    try {
      if ('wakeLock' in navigator) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
      }
    } catch (err) {
      console.warn('Wake Lock re-acquire warning:', err);
    }
  }
});

