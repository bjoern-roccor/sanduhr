import { Timer, clampSeconds, splitSeconds, formatClock } from './timer.js';
import { Hourglass } from './hourglass.js';
import { unlockAudio, startAlarm, stopAlarm } from './audio.js';
import { acquireWakeLock, releaseWakeLock, onWakeLockChange } from './wakelock.js';
import { COLORS, loadColor, saveColor, applyTheme, themeVars } from './theme.js';

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
let starting = false; // Sanduhr wird gerade umgedreht, die Zeit läuft noch nicht

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
  pauseBtn.disabled = starting;
  status.textContent = { running: '', paused: 'Pausiert', finished: 'Zeit abgelaufen' }[state] ?? '';
  hourglass.setPaused(state === 'paused');
  hourglass.invalidate();
  updateHint();
}

function start() {
  unlockAudio(); // Browser erlauben Ton nur nach einer Nutzergeste
  acquireWakeLock();
  shown = '';
  readout.textContent = formatClock(duration * 1000);
  starting = true;
  setState('running');
  // Die Sanduhr wird umgedreht. Erst wenn der Sand zur Ruhe kommt, beginnt die Zeit zu laufen.
  hourglass.flip(() => {
    starting = false;
    pauseBtn.disabled = false;
    timer.start(duration);
  });
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
  starting = false;
  hourglass.cancelFlip();
  timer.reset();
  releaseWakeLock();
  setState('idle');
  hourglass.settle(); // Restsand läuft durch, bis alles unten liegt
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
  else if (!starting) togglePause();
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
  // Vor dem Start liegt der Sand ganz unten (Fortschritt 1); beim Umdrehen beginnt er oben (0)
  const progress = starting ? 0 : state === 'idle' ? 1 : timer.progress;
  if (flowing || hourglass.busy) hourglass.draw(now, progress, flowing);
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

// ---------- Menü: Hintergrundfarbe ----------
const menu = $('#menu');
const menuBtn = $('#menuBtn');
const backdrop = $('#menuBackdrop');
let bgColor = loadColor();

function setMenu(open) {
  menu.hidden = backdrop.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.swatch[aria-checked="true"]')?.focus();
  else menuBtn.focus({ preventScroll: true });
}

function setColor(hex) {
  bgColor = hex;
  hourglass.setLight(applyTheme(hex));
  saveColor(hex);
  for (const sw of document.querySelectorAll('.swatch')) {
    const on = sw.dataset.hex === hex;
    sw.setAttribute('aria-checked', String(on));
    sw.tabIndex = on ? 0 : -1;
  }
  $('#colorName').textContent = COLORS.find((c) => c.hex === hex)?.name ?? '';
}

for (const c of COLORS) {
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'swatch';
  sw.dataset.hex = c.hex;
  sw.style.setProperty('--sw', c.hex);
  sw.style.setProperty('--check', themeVars(c.hex).light ? '#1b1208' : '#fff');
  sw.setAttribute('role', 'radio');
  sw.setAttribute('aria-label', c.name);
  sw.title = c.name;
  sw.addEventListener('click', () => setColor(c.hex));
  $('#swatches').append(sw);
}
menuBtn.addEventListener('click', () => setMenu(menu.hidden));
$('#menuClose').addEventListener('click', () => setMenu(false));
backdrop.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });

setColor(bgColor);
renderSetup();
setState('idle');
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Betrieb optional */ });
  // Neue Version aktiv geworden: im Ruhezustand sofort neu laden, damit die Änderungen sichtbar sind
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && timer.state === 'idle' && !starting) location.reload();
  });
}
