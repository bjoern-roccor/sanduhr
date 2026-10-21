// Alarm per Web Audio (synthetisierte Glockentöne, keine Audiodateien) plus Vibration.

const MAX_ALARM_MS = 60_000; // Obergrenze, danach schaltet sich der Alarm von selbst ab
const PATTERN_MS = 2400; // Dauer eines Durchlaufs aus drei Glockenschlägen
const NOTES = [880, 1174.66, 1567.98]; // A5, D6, G6

let ctx = null;
let loopTimer = null;
let stopTimer = null;

/** Muss durch eine Nutzergeste (Tippen auf Start) aufgerufen werden, damit Ton später erlaubt ist. */
export function unlockAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') ctx.resume();
    // Stiller Ton, damit der Kontext sicher "aktiviert" ist
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch { /* Audio nicht verfügbar */ }
}

function bell(freq, when, volume = 0.5) {
  // Glocke: Grundton plus unharmonische Obertöne mit schnellem Abklingen
  const partials = [
    [1, 1],
    [2.76, 0.45],
    [5.4, 0.2],
    [8.93, 0.08],
  ];
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, when);
  master.gain.exponentialRampToValueAtTime(volume, when + 0.006);
  master.gain.exponentialRampToValueAtTime(0.0001, when + 1.9);
  master.connect(ctx.destination);
  for (const [ratio, amp] of partials) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    g.gain.value = amp;
    o.connect(g).connect(master);
    o.start(when);
    o.stop(when + 2);
  }
}

function playPattern() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  NOTES.forEach((f, i) => bell(f, t0 + i * 0.38));
  if (navigator.vibrate) navigator.vibrate([350, 150, 350, 150, 350]);
}

export function isAlarmPlaying() {
  return loopTimer !== null;
}

/** @param {() => void} [onAutoStop] wird aufgerufen, wenn die Obergrenze den Alarm beendet */
export function startAlarm(onAutoStop) {
  stopAlarm();
  try {
    unlockAudio();
    playPattern();
  } catch { /* Ton nicht möglich, Vibration/Anzeige bleiben */ }
  loopTimer = setInterval(() => {
    try { playPattern(); } catch { /* ignorieren */ }
  }, PATTERN_MS);
  stopTimer = setTimeout(() => {
    stopAlarm();
    onAutoStop?.();
  }, MAX_ALARM_MS);
}

export function stopAlarm() {
  clearInterval(loopTimer);
  clearTimeout(stopTimer);
  loopTimer = stopTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}
