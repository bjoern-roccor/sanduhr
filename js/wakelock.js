// Hält den Bildschirm an (kein Ausschalten, kein Dimmen) per Screen Wake Lock API.
// Der Browser gibt den Lock frei, sobald die App in den Hintergrund geht. Beim Zurückkehren
// wird er automatisch neu angefordert.

let sentinel = null;
let wanted = false;
let listener = () => {};

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

/** @param {(status: 'active' | 'off' | 'unsupported' | 'denied') => void} fn */
export function onWakeLockChange(fn) {
  listener = fn;
}

async function request() {
  if (!wakeLockSupported) return listener('unsupported');
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    const s = await navigator.wakeLock.request('screen');
    if (!wanted) { // zwischenzeitlich wieder abbestellt
      s.release().catch(() => {});
      return;
    }
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
      listener('off');
    });
    listener('active');
  } catch {
    listener('denied');
  }
}

export function acquireWakeLock() {
  wanted = true;
  return request();
}

export async function releaseWakeLock() {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  try { await s?.release(); } catch { /* schon freigegeben */ }
  listener('off');
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted && !sentinel) request();
});
