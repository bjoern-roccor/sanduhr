// Zeichnet die Sanduhr (Holzrahmen, Glas, Sand, Rieselstrahl) auf ein Canvas.
// Alle Maße stammen aus geometry.js (Einheitskoordinaten, Skalierung per Transform).

import { R, WALL, radius, outline, sandState, toLocal } from './geometry.js';

const HALF_W = 0.88; // halbe Breite der Holzplatten
const HALF_H = 1.14; // halbe Gesamthöhe inkl. Platten
const ROT_TIME = 0.95; // Sekunden für das Hinlegen/Aufrichten
const POST_X = 0.745;

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function polyPath(points) {
  const p = new Path2D();
  points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Hourglass {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.glassPath = polyPath(outline(0));
    this.innerPath = polyPath(outline(WALL));
    this.rotT = 0; // 0 aufrecht … 1 liegend (linear, wird eased)
    this.target = 0;
    this.flow = 0; // Deckkraft des Rieselstrahls
    this.flowTarget = 0;
    this.last = null;
    this.dirty = true;
    this.W = 0;
    this.H = 0;
    this.S = 1;
    this.dpr = 1;
    this.grain = this.#makeGrain();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }
  }

  /** true = Sanduhr liegt auf der Seite (Pause) */
  setPaused(paused) {
    this.target = paused ? 1 : 0;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  /** true, solange noch etwas animiert (Drehung, Ein-/Ausblenden des Strahls) oder neu gezeichnet werden muss */
  get busy() {
    return this.dirty
      || Math.abs(this.rotT - this.target) > 1e-4
      || Math.abs(this.flow - this.flowTarget) > 0.004;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    // liegend ist die Sanduhr 2·HALF_H breit, beim Kippen schwenkt die Diagonale aus
    this.S = Math.min(this.W / (2 * HALF_H + 0.16), this.H / 2.95);
    this.sandGradient = null;
    this.invalidate();
  }

  #makeGrain() {
    const size = 96;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = Math.random();
      const dark = v < 0.5;
      const a = dark ? 0.35 * (0.5 - v) * 2 : 0.4 * (v - 0.5) * 2;
      img.data[i * 4] = dark ? 70 : 255;
      img.data[i * 4 + 1] = dark ? 45 : 240;
      img.data[i * 4 + 2] = dark ? 15 : 190;
      img.data[i * 4 + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    return this.ctx.createPattern(c, 'repeat');
  }

  /**
   * @param {number} now Zeit in ms (requestAnimationFrame)
   * @param {number} progress 0 (oben voll) … 1 (unten voll)
   * @param {boolean} flowing true, wenn Sand rieselt
   */
  draw(now, progress, flowing) {
    const dt = this.last == null ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.dirty = false;

    // Drehung
    const step = dt / ROT_TIME;
    if (this.rotT < this.target) this.rotT = Math.min(this.target, this.rotT + step);
    else if (this.rotT > this.target) this.rotT = Math.max(this.target, this.rotT - step);
    const e = easeInOut(this.rotT);
    const phi = e * Math.PI / 2;

    // Rieselstrahl ein-/ausblenden
    this.flowTarget = flowing && progress < 1 && this.target === 0 ? 1 : 0;
    const k = 1 - Math.exp(-dt * (this.flowTarget ? 10 : 18));
    this.flow += (this.flowTarget - this.flow) * k;
    if (Math.abs(this.flow - this.flowTarget) < 0.004) this.flow = this.flowTarget;

    const { ctx, W, H, S, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Die Sanduhr steht immer auf dem Boden: tiefster Punkt des gedrehten Rahmens
    const bottomExt = HALF_W * Math.sin(phi) + HALF_H * Math.cos(phi);
    const ground = Math.min(H - 0.1 * S, H / 2 + 1.3 * S);
    const cx = W / 2;
    const cy = ground - bottomExt * S;

    this.#drawShadow(cx, ground, e);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(S, S);
    ctx.rotate(phi);
    this.#drawPosts();
    this.#drawGlassBack();
    this.#drawSand(progress, phi, now / 1000);
    this.#drawGlassFront();
    this.#drawPlates();
    ctx.restore();
  }

  #drawShadow(cx, ground, e) {
    const { ctx, S } = this;
    const rx = (0.95 + 0.3 * e) * S;
    const ry = 0.09 * S;
    const lift = 1 - 0.35 * Math.sin(Math.PI * e); // beim Kippen kurz leichter
    ctx.save();
    ctx.translate(cx, ground + 0.01 * S);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${0.55 * lift})`);
    g.addColorStop(0.65, `rgba(0,0,0,${0.28 * lift})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #drawPosts() {
    const { ctx } = this;
    const w = 0.075;
    for (const sx of [-1, 1]) {
      const x = sx * POST_X - w / 2;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#2b170a');
      g.addColorStop(0.3, '#8c5c30');
      g.addColorStop(0.5, '#a8743e');
      g.addColorStop(0.78, '#64401f');
      g.addColorStop(1, '#25130a');
      ctx.fillStyle = g;
      ctx.fillRect(x, -1.02, w, 2.04);
      // gedrechselte Ringe
      for (const y of [-0.74, -0.37, 0, 0.37, 0.74]) {
        const rg = ctx.createLinearGradient(x - 0.012, 0, x + w + 0.012, 0);
        rg.addColorStop(0, '#1d0f06');
        rg.addColorStop(0.35, '#6f4624');
        rg.addColorStop(0.55, '#7d5029');
        rg.addColorStop(1, '#1d0f06');
        ctx.fillStyle = rg;
        roundRect(ctx, x - 0.012, y - 0.02, w + 0.024, 0.04, 0.012);
        ctx.fill();
      }
    }
  }

  #drawGlassBack() {
    const { ctx } = this;
    const g = ctx.createLinearGradient(-R, 0, R, 0);
    g.addColorStop(0, 'rgba(150,200,255,0.16)');
    g.addColorStop(0.4, 'rgba(210,235,255,0.05)');
    g.addColorStop(0.7, 'rgba(160,205,255,0.07)');
    g.addColorStop(1, 'rgba(150,200,255,0.18)');
    ctx.fillStyle = g;
    ctx.fill(this.glassPath);
  }

  #sandFill() {
    if (!this.sandGradient) {
      const g = this.ctx.createLinearGradient(-R, 0, R, 0);
      g.addColorStop(0, '#8a6326');
      g.addColorStop(0.22, '#d6ae60');
      g.addColorStop(0.45, '#ecc983');
      g.addColorStop(0.7, '#cfa452');
      g.addColorStop(1, '#7d5a22');
      this.sandGradient = g;
    }
    return this.sandGradient;
  }

  /** Oberfläche eines Sandhaufens als Punktliste in Glaskoordinaten */
  #surface(b, phi, seed) {
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    const pts = [];
    const add = (u, v) => pts.push([u * cs + v * sn, -u * sn + v * cs]);
    const jitter = (i) => (hash(i * 3.17 + seed) - 0.5) * 0.007;
    if (b.finite) {
      const base = b.L + 0.6;
      add(b.uc - b.w, base);
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const u = b.uc - b.w + (2 * b.w * i) / n;
        const rho = Math.abs(u - b.uc) / b.w;
        add(u, b.L + b.amp * (1 - rho) + (i > 0 && i < n ? jitter(i) : 0));
      }
      add(b.uc + b.w, base);
      return { pts, surfaceFrom: 1, surfaceTo: n + 1 };
    }
    const U0 = -1.45;
    const U1 = 1.45;
    const n = 240;
    add(U0, b.L + 3);
    for (let i = 0; i <= n; i++) {
      const u = U0 + ((U1 - U0) * i) / n;
      const rho = Math.abs(u - b.uc) / b.w;
      const f = rho < 1 ? b.amp * (1 - rho) : 0;
      add(u, b.L + f + jitter(i));
    }
    add(U1, b.L + 3);
    return { pts, surfaceFrom: 1, surfaceTo: n + 1 };
  }

  #drawBulbSand(b, phi, clipTop, seed) {
    const { ctx } = this;
    const { pts, surfaceFrom, surfaceTo } = this.#surface(b, phi, seed);
    ctx.save();
    ctx.beginPath();
    if (clipTop) ctx.rect(-1.5, -1.5, 3, 1.515);
    else ctx.rect(-1.5, 0, 3, 1.5);
    ctx.clip();

    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = this.#sandFill();
    ctx.fill();

    // Körnung
    this.grain.setTransform(new DOMMatrix().scale(0.75 / this.S));
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = this.grain;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Lichtkante an der Oberfläche
    ctx.beginPath();
    for (let i = surfaceFrom; i < surfaceTo; i++) {
      const [x, y] = pts[i];
      if (i === surfaceFrom) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255,238,184,0.5)';
    ctx.lineWidth = 0.009;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  #drawSand(progress, phi, t) {
    const { ctx } = this;
    const st = sandState(progress, phi);
    ctx.save();
    ctx.clip(this.innerPath);
    if (st.top) this.#drawBulbSand(st.top, phi, true, 1);
    if (st.bottom) this.#drawBulbSand(st.bottom, phi, false, 7);

    // weiche Schattierung zum Glasrand hin
    const shade = ctx.createLinearGradient(-R, 0, R, 0);
    shade.addColorStop(0, 'rgba(20,10,0,0.28)');
    shade.addColorStop(0.18, 'rgba(20,10,0,0)');
    shade.addColorStop(0.8, 'rgba(20,10,0,0)');
    shade.addColorStop(1, 'rgba(20,10,0,0.3)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shade;
    ctx.fillRect(-R, -1, 2 * R, 2);
    ctx.globalCompositeOperation = 'source-over';

    if (this.flow > 0.004 && st.bottom) this.#drawStream(st.bottom, phi, t);
    ctx.restore();
  }

  #drawStream(b, phi, t) {
    const { ctx } = this;
    const apex = toLocal(b.uc, b.L + b.amp, phi);
    const y0 = -0.03;
    const y1 = apex.y + 0.012;
    const len = y1 - y0;
    if (len <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = this.flow;

    const w = 0.014;
    const sg = ctx.createLinearGradient(-w, 0, w, 0);
    sg.addColorStop(0, 'rgba(190,150,70,0.0)');
    sg.addColorStop(0.5, 'rgba(236,205,130,0.95)');
    sg.addColorStop(1, 'rgba(190,150,70,0.0)');
    ctx.fillStyle = sg;
    ctx.fillRect(-w, y0, 2 * w, len);

    // bewegte Körner
    const count = 46;
    const speed = 1.6;
    for (let i = 0; i < count; i++) {
      const f = (i / count + (t * speed) / len * 0.35) % 1;
      const y = y0 + f * len;
      const spread = 0.004 + 0.006 * f;
      const x = (hash(i * 5.3) - 0.5) * 2 * spread;
      ctx.fillStyle = hash(i * 1.9) > 0.5 ? 'rgba(250,228,165,0.95)' : 'rgba(200,160,80,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, 0.0042 + hash(i * 2.2) * 0.0025, 0, Math.PI * 2);
      ctx.fill();
    }

    // aufstäubende Körner am Kegel
    const frame = Math.floor(t * 24);
    for (let j = 0; j < 9; j++) {
      const a = hash(j * 9.1 + frame * 0.37);
      const bnc = hash(j * 4.7 + frame * 1.13);
      const dx = (a - 0.5) * 0.11;
      const dy = -bnc * 0.045 * (1 - Math.abs(a - 0.5) * 1.2);
      ctx.fillStyle = 'rgba(236,205,130,0.75)';
      ctx.beginPath();
      ctx.arc(apex.x + dx, apex.y + dy, 0.004, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #streak(side, y0, y1, width, alpha) {
    const { ctx } = this;
    ctx.beginPath();
    const n = 30;
    for (let i = 0; i <= n; i++) {
      const y = y0 + ((y1 - y0) * i) / n;
      const x = side * radius(y) * 0.8;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  #drawGlassFront() {
    const { ctx } = this;
    // Glasränder
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = 'rgba(205,230,255,0.38)';
    ctx.stroke(this.glassPath);
    ctx.lineWidth = 0.006;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke(this.innerPath);

    // Reflexe
    this.#streak(-1, -0.92, -0.16, 0.04, 0.3);
    this.#streak(-1, 0.16, 0.92, 0.04, 0.22);
    this.#streak(1, -0.8, -0.2, 0.016, 0.14);
    this.#streak(1, 0.2, 0.8, 0.016, 0.14);
    this.#streak(-1, -0.97, -0.9, 0.05, 0.12);
  }

  #drawPlates() {
    const { ctx } = this;
    for (const top of [true, false]) {
      const y = top ? -1.14 : 1.0;
      const h = 0.14;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, top ? '#a8763f' : '#8e5f30');
      g.addColorStop(0.5, '#6b4322');
      g.addColorStop(1, top ? '#3d2411' : '#4d2f17');
      ctx.fillStyle = g;
      roundRect(ctx, -HALF_W, y, 2 * HALF_W, h, 0.035);
      ctx.fill();
      // Maserung
      ctx.strokeStyle = 'rgba(40,20,8,0.22)';
      ctx.lineWidth = 0.004;
      for (let i = 0; i < 6; i++) {
        const gy = y + 0.02 + hash(i * 3 + (top ? 1 : 2)) * (h - 0.04);
        ctx.beginPath();
        ctx.moveTo(-HALF_W + 0.04, gy);
        ctx.lineTo(HALF_W - 0.04, gy + (hash(i) - 0.5) * 0.01);
        ctx.stroke();
      }
      // Glanzkante
      ctx.strokeStyle = 'rgba(255,220,160,0.4)';
      ctx.lineWidth = 0.006;
      ctx.beginPath();
      const ey = top ? y + 0.008 : y + 0.008;
      ctx.moveTo(-HALF_W + 0.04, ey);
      ctx.lineTo(HALF_W - 0.04, ey);
      ctx.stroke();
      // Messingring am Glas
      const ry = top ? y + h : y - 0.03;
      const bg = ctx.createLinearGradient(0, ry, 0, ry + 0.03);
      bg.addColorStop(0, '#b8933f');
      bg.addColorStop(1, '#6e5019');
      ctx.fillStyle = bg;
      ctx.fillRect(-0.4, ry, 0.8, 0.03);
    }
  }
}
