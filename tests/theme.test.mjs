import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, DEFAULT_COLOR, isLight, themeVars, contrast, luminance } from '../js/theme.js';

test('genau 20 verschiedene, gültige Farben mit Namen', () => {
  assert.equal(COLORS.length, 20);
  assert.equal(new Set(COLORS.map((c) => c.hex)).size, 20);
  assert.equal(new Set(COLORS.map((c) => c.name)).size, 20);
  for (const c of COLORS) {
    assert.match(c.hex, /^#[0-9a-f]{6}$/);
    assert.ok(c.name.length > 2);
  }
  assert.ok(COLORS.some((c) => c.hex === DEFAULT_COLOR));
});

test('Hell/Dunkel-Erkennung', () => {
  assert.equal(isLight('#000000'), false);
  assert.equal(isLight('#14110f'), false);
  assert.equal(isLight('#1f3f8f'), false);
  assert.equal(isLight('#efe4cf'), true);
  assert.equal(isLight('#d8d8d4'), true);
  assert.equal(isLight('#c39a2b'), true); // Senf: dunkle Schrift
  assert.equal(isLight('#9c4529'), false); // Terrakotta: helle Schrift
});

test('Schrift ist auf jeder Farbe gut lesbar (Kontrast ≥ 4,5)', () => {
  for (const c of COLORS) {
    const { vars } = themeVars(c.hex);
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const text = contrast(rgbOf(vars['--text']), rgbOf(vars['--bg']));
    assert.ok(text >= 4.5, `${c.name}: Text-Kontrast ${text.toFixed(2)}`);
    const muted = contrast(rgbOf(vars['--muted']), rgbOf(vars['--bg']));
    assert.ok(muted >= 3, `${c.name}: gedämpfter Text ${muted.toFixed(2)}`);
  }
});

test('Leuchtdichte: Schwarz 0, Weiß 1', () => {
  assert.equal(luminance([0, 0, 0]), 0);
  assert.ok(Math.abs(luminance([255, 255, 255]) - 1) < 1e-9);
});
