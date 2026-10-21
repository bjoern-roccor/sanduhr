import test from 'node:test';
import assert from 'node:assert/strict';
import {
  radius, outline, sandState, toLocal, planeVolume,
  BULB_VOLUME, SAND_VOLUME, NECK, R,
} from '../js/geometry.js';

test('Profil: Hals eng, Kolben breit, symmetrisch', () => {
  assert.ok(Math.abs(radius(0) - NECK) < 1e-9);
  assert.ok(Math.abs(radius(0.5) - R) < 1e-9);
  assert.equal(radius(-0.7), radius(0.7));
  for (let y = -1; y <= 1; y += 0.01) {
    assert.ok(radius(y) >= NECK - 1e-9 && radius(y) <= R + 1e-9);
  }
  assert.ok(outline(0).length > 100);
});

test('Sandmenge passt in einen Kolben', () => {
  assert.ok(SAND_VOLUME > 0.2 * BULB_VOLUME && SAND_VOLUME < 0.7 * BULB_VOLUME);
});

test('aufrecht: Sand wandert von oben nach unten', () => {
  const start = sandState(0, 0);
  const mid = sandState(0.5, 0);
  const end = sandState(1, 0);
  assert.ok(start.top && !start.bottom);
  assert.ok(mid.top && mid.bottom);
  assert.ok(!end.top && end.bottom);
  // Oberfläche oben sinkt (L steigt, y nach unten), unten steigt sie (L sinkt)
  assert.ok(mid.top.L > start.top.L);
  assert.ok(end.bottom.L + end.bottom.amp < mid.bottom.L + mid.bottom.amp);
});

test('aufrecht: Kegelspitze bleibt unterhalb des Halses, Sand im Glas', () => {
  for (let p = 0.01; p <= 1; p += 0.01) {
    const s = sandState(p, 0);
    if (s.bottom) {
      const apex = s.bottom.L + s.bottom.amp;
      assert.ok(apex > 0.08, `Kegel zu hoch bei p=${p}: ${apex}`);
      assert.ok(apex <= 1.0001);
    }
    if (s.top) {
      assert.ok(s.top.L >= -1 && s.top.L <= 0.0001, `Oberfläche oben bei p=${p}: ${s.top.L}`);
    }
  }
});

test('Volumenerhaltung im gekippten Zustand (ohne Kegel/Trichter)', () => {
  for (const phi of [0.4, 0.8, Math.PI / 2]) {
    for (const p of [0.1, 0.5, 0.9]) {
      const s = sandState(p, phi);
      const vt = planeVolume(-1, phi, s.top.L);
      const vb = planeVolume(1, phi, s.bottom.L);
      assert.ok(Math.abs(vt - SAND_VOLUME * (1 - p)) < 2e-3, `oben phi=${phi} p=${p}`);
      assert.ok(Math.abs(vb - SAND_VOLUME * p) < 2e-3, `unten phi=${phi} p=${p}`);
    }
  }
});

test('liegend: Sandebene ist waagerecht (Schwerkraft entlang +x)', () => {
  const s = sandState(0.5, Math.PI / 2);
  assert.ok(s.top.L > -1 && s.top.L < R);
  const pt = toLocal(0, s.top.L, Math.PI / 2);
  assert.ok(Math.abs(pt.x - s.top.L) < 1e-9);
  assert.ok(Math.abs(s.top.amp) < 1e-12);
  assert.ok(Math.abs(s.bottom.amp) < 1e-12);
});

test('Übergang aufrecht → gekippt ist stetig', () => {
  let prev = sandState(0.5, 0).top.L;
  for (let phi = 0.01; phi <= Math.PI / 2; phi += 0.01) {
    const L = sandState(0.5, phi).top.L;
    assert.ok(Math.abs(L - prev) < 0.06, `Sprung bei phi=${phi}: ${prev} → ${L}`);
    prev = L;
  }
});

test('Mulde: Volumen bleibt erhalten, kleinere Mulde senkt den Rand', () => {
  const p = 0.4;
  const V = SAND_VOLUME * (1 - p);
  const big = sandState(p, 0, 0.02).top;
  const small = sandState(p, 0, 0.004).top;
  for (const t of [big, small]) {
    const vol = planeVolume(-1, 0, t.L) - (Math.PI / 3) * t.w * t.w * t.amp;
    assert.ok(Math.abs(vol - V) < 3e-3, `Volumen ${vol} statt ${V}`);
  }
  // Rutscht Sand vom Rand in die Mulde, sinkt der Rand (y nach unten, oben ist L negativ → größer)
  assert.ok(small.L > big.L, 'Rand sinkt nach dem Zusammenrutschen');
  assert.ok(small.amp < big.amp && small.w < big.w);
});

test('Mulde: wächst mit dem Volumen, Böschungswinkel bleibt, Spitze über dem Hals', () => {
  let prev = 0;
  for (let vc = 0.001; vc < 0.05; vc += 0.002) {
    const t = sandState(0.3, 0, vc).top;
    assert.ok(t.amp >= prev - 1e-9);
    prev = t.amp;
    assert.ok(Math.abs(t.amp / t.w - Math.tan((34 * Math.PI) / 180)) < 1e-6 || t.w === 0);
    assert.ok(-t.L - t.amp >= 0.049, 'Spitze zu nah am Hals');
  }
});

test('Mulde verschwindet beim Kippen', () => {
  assert.ok(sandState(0.4, 0, 0.02).top.amp > 0.05);
  assert.ok(Math.abs(sandState(0.4, 0.35, 0.02).top.amp) < 1e-9);
});
