// Hintergrundfarben: 20 Auswahlfarben. Aus der gewählten Farbe werden Text-, Rand- und
// Flächenfarben so abgeleitet, dass die Oberfläche auf hellen und dunklen Farben lesbar bleibt.

export const COLORS = [
  { name: 'Nachtbraun', hex: '#14110f' },
  { name: 'Schwarz', hex: '#000000' },
  { name: 'Anthrazit', hex: '#23272d' },
  { name: 'Schiefer', hex: '#3a4656' },
  { name: 'Mitternachtsblau', hex: '#0f1c33' },
  { name: 'Königsblau', hex: '#1f3f8f' },
  { name: 'Petrol', hex: '#0e4650' },
  { name: 'Tannengrün', hex: '#12301f' },
  { name: 'Waldgrün', hex: '#2a6a3c' },
  { name: 'Oliv', hex: '#55601f' },
  { name: 'Weinrot', hex: '#5a1424' },
  { name: 'Aubergine', hex: '#331a40' },
  { name: 'Violett', hex: '#5b3a9a' },
  { name: 'Kastanie', hex: '#5a3420' },
  { name: 'Terrakotta', hex: '#9c4529' },
  { name: 'Senf', hex: '#c39a2b' },
  { name: 'Meergrün', hex: '#17695d' },
  { name: 'Himmelblau', hex: '#7aa9dd' },
  { name: 'Creme', hex: '#efe4cf' },
  { name: 'Hellgrau', hex: '#d8d8d4' },
];

export const DEFAULT_COLOR = COLORS[0].hex;
const STORAGE_KEY = 'sanduhr.bg';
const LIGHT_TEXT = [241, 230, 211];
const DARK_TEXT = [38, 28, 18];

const HEX = /^#[0-9a-f]{6}$/i;
const parse = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Relative Leuchtdichte nach WCAG (0 schwarz … 1 weiß) */
export function luminance(c) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** true, wenn auf dieser Farbe dunkle Schrift besser lesbar ist */
export function isLight(hex) {
  const bg = parse(hex);
  return contrast(bg, DARK_TEXT) > contrast(bg, LIGHT_TEXT);
}

/** CSS-Variablen für eine Hintergrundfarbe */
export function themeVars(hex) {
  const bg = parse(hex);
  const light = isLight(hex);
  const text = light ? DARK_TEXT : LIGHT_TEXT;
  return {
    light,
    vars: {
      '--bg': hex,
      '--bg-2': toHex(mix(bg, text, 0.09)),
      '--press': toHex(mix(bg, text, 0.18)),
      '--line': toHex(mix(bg, text, 0.24)),
      '--muted': toHex(mix(bg, text, 0.76)),
      '--text': toHex(text),
      '--glow': toHex(light ? mix(bg, [255, 255, 255], 0.4) : mix(bg, [255, 205, 150], 0.1)),
      '--input': toHex(light ? mix(bg, [255, 255, 255], 0.55) : mix(bg, [0, 0, 0], 0.4)),
    },
  };
}

export function loadColor() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && HEX.test(v)) return v.toLowerCase();
  } catch { /* Speicher nicht verfügbar */ }
  return DEFAULT_COLOR;
}

export function saveColor(hex) {
  try { localStorage.setItem(STORAGE_KEY, hex); } catch { /* ignorieren */ }
}

/** Setzt die Farbe im Dokument. Gibt zurück, ob der Hintergrund hell ist. */
export function applyTheme(hex) {
  const { light, vars } = themeVars(hex);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);
  return light;
}
