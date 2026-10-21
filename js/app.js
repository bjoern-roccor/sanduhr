import { Timer, clampSeconds, splitSeconds, formatClock } from './timer.js';
import { Hourglass } from './hourglass.js';
import { unlockAudio, startAlarm, stopAlarm } from './audio.js';
import { acquireWakeLock, releaseWakeLock, onWakeLockChange } from './wakelock.js';

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'sanduhr.duration';
const PRESETS = [30, 60, 180, 300, 600, 900, 1800];

const timer = new Timer();
const hourglass = new Hourglass($('#glass'));
const minInput = $('#min');
const secInput = $('#sec');
const readout = $('#readout');
const status = $('#status');
const hint = $('#hint');
const pauseBtn = $('#pauseBtn');

let duration = loadDuration();
let wakeStatus = 'off';

// ---------- Dauer ----------
function loadDuration() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (v) return clampSeconds(v);
  } catch { /* Speicher nicht verfügbar */ }
  return 300;
}

function saveDuration() {
  try { localStorage.setItem(STORAGE_KEY, String(duration)); } catch { /* ignorieren */ }
}

const pad = (n) => String(n).padStart(2, '0');

function renderSetup() {
  const { minutes, seconds } = splitSeconds(duration);
  if (document.activeElement !== minInput) minInput.value = pad(minutes);
  if (document.activeElement !== secInput) secInput.value = pad(seconds);
  for (const chip of document.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(Number(chip.dataset.seconds) === duration));
  }
  if (timer.state === 'idle') readout.textContent = formatClock(duration * 1000);
}

function setDuration(seconds) {
  duration = clampSeconds(seconds);
  saveDuration();
  renderSetup();
}

function readInputs() {
  const m = Math.min(30, parseInt(minInput.value, 10) || 0);
  const s = Math.min(59, parseInt(secInput.value, 10) || 0);
  setDuration(m * 60 + s);
  minInput.value = pad(splitSeconds(duration).minutes);
  secInput.value = pad(splitSeconds(duration).seconds);
}

for (const input of [minInput, secInput]) {
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); });
  input.addEventListener('change', readInputs);
  input.addEventListener('blur', readInputs);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
}

// Plus/Minus-Tasten: bei gedrückt halten wiederholen
for (const btn of document.querySelectorAll('.step')) {
  const delta = Number(btn.dataset.delta);
  let first;
  let repeat;
  const stop = () => { clearTimeout(first); clearInterval(repeat); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    setDuration(duration + delta);
    first = setTimeout(() => { repeat = setInterval(() => setDuration(duration + delta), 90); }, 420);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', (e) => { if (e.detail === 0) setDuration(duration + delta); }); // Tastatur
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Schnellwahl
for (const s of PRESETS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.dataset.seconds = s;
  chip.textContent = s < 60 ? `${s} s` : `${s / 60} min`;
  chip.addEventListener('click', () => setDuration(s));
  $('#chips').append(chip);
}

// ---------- Zustände ----------
function setState(state) {
  document.body.dataset.state = state;
  pauseBtn.textContent = state === 'paused' ? 'Weiter' : 'Pause';
  status.textContent = { running: '', paused: 'Pausiert', finished: 'Zeit abgelaufen' }[state] ?? '';
  hourglass.setPaused(state === 'paused');
  hourglass.invalidate();
  updateHint();
}

function start() {
  unlockAudio(); // Browser erlauben Ton nur nach einer Nutzergeste
  acquireWakeLock();
  shown = '';
  timer.start(duration);
  setState('running');
}

function togglePause() {
  if (timer.state === 'running') {
    timer.pause();
    setState('paused');
  } else if (timer.state === 'paused') {
    timer.resume();
    setState('running');
  }
}

function reset() {
  stopAlarm();
  timer.reset();
  releaseWakeLock();
  setState('idle');
  renderSetup();
}

function finish() {
  startAlarm(() => releaseWakeLock()); // Nach dem automatischen Ende des Alarms Bildschirm freigeben
  setState('finished');
}

$('#startBtn').addEventListener('click', start);
pauseBtn.addEventListener('click', togglePause);
$('#resetBtn').addEventListener('click', reset);
$('#doneBtn').addEventListener('click', reset);
$('#againBtn').addEventListener('click', () => {
  stopAlarm();
  start();
});
// Antippen der Sanduhr: Pause/Weiter bzw. Alarm beenden
$('#stage').addEventListener('click', () => {
  if (timer.state === 'finished') reset();
  else togglePause();
});

// ---------- Hinweis zum Wachhalten ----------
onWakeLockChange((s) => {
  wakeStatus = s;
  updateHint();
});

function updateHint() {
  const active = timer.state === 'running' || timer.state === 'paused';
  let text = '';
  let level = '';
  if (!active) {
    hint.hidden = true;
    return;
  }
  if (wakeStatus === 'active') { text = 'Bildschirm bleibt an'; level = 'ok'; }
  else if (wakeStatus === 'unsupported') { text = 'Dieser Browser kann den Bildschirm nicht wachhalten.'; level = 'warn'; }
  else if (wakeStatus === 'denied') { text = 'Bildschirm-Wachhalten wurde abgelehnt (Energiesparmodus?).'; level = 'warn'; }
  hint.hidden = !text;
  hint.textContent = text;
  hint.dataset.level = level;
}

// ---------- Hauptschleife ----------
let shown = '';

function tick() {
  if (timer.tick()) finish();
}

function frame(now) {
  tick();
  const state = timer.state;
  const flowing = state === 'running';
  if (flowing || hourglass.busy) hourglass.draw(now, timer.progress, flowing);
  if (state !== 'idle') {
    const text = formatClock(state === 'finished' ? 0 : timer.remainingMs);
    if (text !== shown) {
      shown = text;
      readout.textContent = text;
    }
  }
  requestAnimationFrame(frame);
}

// Auch ohne Zeichnen (z. B. kurz im Hintergrund) muss das Ende erkannt werden
setInterval(tick, 250);
document.addEventListener('visibilitychange', () => {
  tick();
  hourglass.invalidate();
});

renderSetup();
setState('idle');
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Betrieb optional */ });
}
