// Erzeugt die PNG-Icons (ohne Abhängigkeiten): node tools/make-icons.mjs
// Das Icon wird pixelweise berechnet (3×3-Supersampling) und per zlib als PNG geschrieben.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { radius } from '../js/geometry.js';

const out = new URL('../icons/', import.meta.url);

// ---- PNG-Encoder ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 Bit
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Motiv in Inhaltskoordinaten (x ∈ ±1, y ∈ ±1.14, y nach unten) ----
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const over = (dst, src, a) => mix(dst, src, a);
const smooth = (t) => t * t * (3 - 2 * t);

function shade(x, y, bgTop, bgBottom) {
  let c = mix(bgTop, bgBottom, (y + 1.2) / 2.4);
  const ax = Math.abs(x);
  const ay = Math.abs(y);

  // Pfosten
  if (ax > 0.7 && ax < 0.79 && ay < 1.02) {
    const t = (ax - 0.7) / 0.09;
    c = mix([70, 42, 20], [168, 116, 62], Math.sin(t * Math.PI));
  }
  // Glas
  if (ay <= 1) {
    const r = radius(y);
    if (ax <= r) {
      c = over(c, [190, 220, 255], 0.14);
      // Sand oben: Spiegel bei y = -0.5, Trichter in der Mitte
      const dip = 0.34 * Math.max(0, 1 - ax / 0.5);
      const topLevel = -0.56 + dip;
      const inTop = y < 0 && y >= topLevel;
      // Sand unten: Kegel
      const coneLevel = Math.min(1, 0.4 + 0.95 * ax);
      const inBottom = y > 0 && y >= coneLevel;
      // Strahl
      const inStream = y > 0 && y < 0.42 && ax < 0.022;
      if (inTop || inBottom || inStream) {
        const shadeX = 0.75 + 0.25 * Math.cos((x / r) * 1.4);
        c = [230 * shadeX, 190 * shadeX, 105 * shadeX];
      }
      if (ax > r - 0.035) c = over(c, [215, 235, 255], 0.55); // Glasrand
    } else if (ax <= r + 0.02) {
      c = over(c, [180, 205, 235], 0.35);
    }
  }
  // Platten
  if (ax < 0.88 && ay > 1 && ay < 1.14) {
    const t = (ay - 1) / 0.14;
    c = mix([170, 118, 62], [60, 36, 17], smooth(t));
  }
  return c;
}

function render(size, { fraction, maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const sc = fraction / 1.14; // Inhalt auf fraction der halben Bildgröße skalieren
  const bgTop = [48, 38, 30];
  const bgBottom = [20, 16, 13];
  const ss = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (2 * (px + (sx + 0.5) / ss)) / size - 1;
          const ny = (2 * (py + (sy + 0.5) / ss)) / size - 1;
          // abgerundetes Quadrat (nur für "any"), maskable bleibt vollflächig
          let inside = true;
          if (!maskable) {
            const q = 0.78;
            const dx = Math.max(Math.abs(nx) - q, 0);
            const dy = Math.max(Math.abs(ny) - q, 0);
            inside = Math.hypot(dx, dy) <= 1 - q;
          }
          if (!inside) continue;
          const c = shade(nx / sc, ny / sc, bgTop, bgBottom);
          r += c[0]; g += c[1]; b += c[2]; a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((255 * a) / (ss * ss));
    }
  }
  return png(size, rgba);
}

writeFileSync(new URL('icon-192.png', out), render(192, { fraction: 0.82, maskable: false }));
writeFileSync(new URL('icon-512.png', out), render(512, { fraction: 0.82, maskable: false }));
// Maskable: Inhalt innerhalb der sicheren Zone (inneren 80 %), Rand wird vom System beschnitten
writeFileSync(new URL('icon-maskable-512.png', out), render(512, { fraction: 0.6, maskable: true }));
console.log('Icons geschrieben in', out.pathname);
