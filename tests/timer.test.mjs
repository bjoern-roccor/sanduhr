import test from 'node:test';
import assert from 'node:assert/strict';
import { Timer, parseDuration, clampSeconds, formatClock, splitSeconds } from '../js/timer.js';

function fakeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('parseDuration: Grenzen', () => {
  assert.equal(parseDuration(0, 0).ok, false); // 0:00
  assert.deepEqual(parseDuration(0, 1), { ok: true, seconds: 1 });
  assert.deepEqual(parseDuration(5, 30), { ok: true, seconds: 330 });
  assert.deepEqual(parseDuration(30, 0), { ok: true, seconds: 1800 });
  assert.equal(parseDuration(30, 1).ok, false); // über 30:00
  assert.equal(parseDuration(31, 0).ok, false);
  assert.equal(parseDuration(1, 60).ok, false);
  assert.equal(parseDuration(-1, 10).ok, false);
  assert.equal(parseDuration(1.5, 10).ok, false);
  assert.equal(parseDuration('x', 10).ok, false);
});

test('clampSeconds und splitSeconds', () => {
  assert.equal(clampSeconds(0), 1);
  assert.equal(clampSeconds(99999), 1800);
  assert.equal(clampSeconds(NaN), 1);
  assert.deepEqual(splitSeconds(125), { minutes: 2, seconds: 5 });
});

test('formatClock rundet auf', () => {
  assert.equal(formatClock(300000), '05:00');
  assert.equal(formatClock(299001), '05:00');
  assert.equal(formatClock(1), '00:01');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(-50), '00:00');
});

test('Timer läuft und endet genau einmal', () => {
  const c = fakeClock();
  const t = new Timer(c.now);
  t.start(10);
  assert.equal(t.state, 'running');
  c.advance(4000);
  assert.equal(t.tick(), false);
  assert.equal(Math.round(t.remainingMs), 6000);
  assert.ok(Math.abs(t.progress - 0.4) < 1e-9);
  c.advance(6000);
  assert.equal(t.tick(), true);
  assert.equal(t.state, 'finished');
  assert.equal(t.progress, 1);
  c.advance(5000);
  assert.equal(t.tick(), false);
  assert.equal(t.progress, 1);
});

test('Pause friert die Zeit ein, Weiter setzt genau fort', () => {
  const c = fakeClock();
  const t = new Timer(c.now);
  t.start(60);
  c.advance(10000);
  t.pause();
  assert.equal(t.state, 'paused');
  c.advance(120000); // lange Pause
  assert.equal(Math.round(t.elapsedMs), 10000);
  t.resume();
  c.advance(5000);
  assert.equal(Math.round(t.elapsedMs), 15000);
  assert.equal(t.tick(), false);
  c.advance(45000);
  assert.equal(t.tick(), true);
});

test('Mehrfaches Pausieren summiert korrekt', () => {
  const c = fakeClock();
  const t = new Timer(c.now);
  t.start(30);
  c.advance(3000); t.pause(); c.advance(1000); t.resume();
  c.advance(3000); t.pause(); c.advance(1000); t.resume();
  c.advance(3000);
  assert.equal(Math.round(t.elapsedMs), 9000);
});

test('Ungültige Übergänge werden ignoriert', () => {
  const c = fakeClock();
  const t = new Timer(c.now);
  t.pause();
  t.resume();
  assert.equal(t.state, 'idle');
  t.start(5);
  t.resume();
  assert.equal(t.state, 'running');
});

test('Reset setzt zurück, Dauer wird begrenzt', () => {
  const c = fakeClock();
  const t = new Timer(c.now);
  t.start(5000); // zu lang → 30:00
  assert.equal(t.durationMs, 1800000);
  c.advance(1000);
  t.reset();
  assert.equal(t.state, 'idle');
  assert.equal(t.progress, 0);
});
