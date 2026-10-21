// Zeichnet die Sanduhr (Holzrahmen, Glas, Sand, Rieselstrahl) auf ein Canvas.
// Alle Maße stammen aus geometry.js (Einheitskoordinaten, Skalierung per Transform).
//
// Ausrichtung: Das Glas dreht sich um den Winkel theta. base = 0 ist aufrecht, base = 1 steht
// auf dem Kopf (nach jedem Start wechselt base). Pausiert liegt die Sanduhr (theta = π/2).
// Der Sand wird immer relativ zur Schwerkraft berechnet. Für theta > π/2 wird das Glas an
// seiner Querachse gespiegelt (es ist symmetrisch), damit geometry.js nur 0…π/2 braucht.

import { R, WALL, SAND_AREA, radius, innerRadius, outline, sandState, toLocal } from './geometry.js';

const PI = Math.PI;
const HALF_W = 0.88; // halbe Breite der Holzplatten
const HALF_H = 1.14; // halbe Gesamthöhe inkl. Platten
const POST_X = 0.745;
const SAND_LAG = 5; // 1/s: Der Sand folgt der Schwerkraftrichtung zähflüssig
const SETTLE_RATE = 0.9; // Fortschritt pro Sekunde, wenn der Rest beim Zurücksetzen ausläuft
const GRAVITY = 2.4; // Fallbeschleunigung der Sandkörner im Strahl (Einheiten/s²)

const BRIGHT = [168, 118, 63];
const MID = [107, 67, 34];
const DARK = [61, 36, 17];

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const vnoise = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

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

    // Ausrichtung
    this.base = 0; // 0 aufrecht, 1 umgedreht
    this.theta = 0; // aktueller Drehwinkel des Glases (0…π)
    this.paused = false;
    this.anim = null; // { from, to, t, dur }
    this.sandTheta = 0; // Schwerkraftrichtung im Glas, folgt theta mit Verzögerung
    this.flipPending = false;
    this.flipCb = null;

    // Sand
    this.pTrue = 1; // echter Fortschritt (1 = Sand ganz unten, so steht die Uhr vor dem Start)
    this.settling = false;
    // Mulde im oberen Kolben: Die Mitte läuft ab, die Mulde vertieft sich bis zur kritischen
    // Neigung, dann rutscht Sand vom Rand nach, die Mulde läuft zusammen und baut sich neu auf.
    this.vc = 0; // Fläche der Mulde im Bild
    this.aval = null; // laufende Lawine { total, e, t, dur, side }
    this.sinceAval = 0;
    this.trigger = 0.5; // Muldenradius/Glasradius, ab dem Sand nachrutscht
    this.timeTrigger = 10; // spätestens nach so vielen Sekunden rutscht auch eine kleinere Lawine
    this.top = null; // zuletzt berechneter Zustand des oberen Sandes
    // Körner, die über die Flanken des Kegels unten rutschen
    this.ripples = [];
    this.nextRipple = 0.5;

    // Rieselstrahl
    this.flow = 0;
    this.flowTarget = 0;
    this.stream = [];
    this.splash = [];
    this.spawnAcc = 0;

    this.clock = 0;
    this.last = null;
    this.dirty = true;
    this.light = false;
    this.lt = 0; // 0 … 1: Licht von oben im Weltraum, folgt der Drehung des Rahmens
    this.W = 0;
    this.H = 0;
    this.S = 1;
    this.Se = 1;
    this.dpr = 1;
    this.grain = this.#makeGrain();
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }
  }

  /** true = Sanduhr liegt auf der Seite (Pause) */
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.#retarget();
  }

  /** Helle Hintergrundfarbe: Glas bekommt dunklere Ränder */
  setLight(light) {
    this.light = light;
    this.invalidate();
  }

  /** Dreht die Sanduhr um. Wenn sie ruhig steht, wird cb aufgerufen (dann soll der Sand laufen). */
  flip(cb) {
    this.settling = false;
    this.base ^= 1;
    this.pTrue = 0; // der Sand ist jetzt oben, der Fortschritt beginnt neu
    this.vc = 0;
    this.aval = null;
    this.sinceAval = 0;
    this.top = null;
    this.ripples.length = 0;
    this.stream.length = 0;
    this.splash.length = 0;
    this.flipCb = cb;
    this.flipPending = true;
    this.#retarget();
  }

  cancelFlip() {
    this.flipCb = null;
    this.flipPending = false;
  }

  /** Zurücksetzen: Der Restsand läuft schnell durch, bis er ganz unten liegt. */
  settle() {
    if (this.pTrue < 1) this.settling = true;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  /** true, solange noch etwas animiert wird oder neu gezeichnet werden muss */
  get busy() {
    return this.dirty
      || this.anim !== null
      || this.flipPending
      || this.settling
      || this.ripples.length > 0
      || Math.abs(this.sandTheta - this.theta) > 0.002
      || Math.abs(this.flow - this.flowTarget) > 0.004
      || this.stream.length > 0
      || this.splash.length > 0;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = Math.max(1, rect.width);
    this.H = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.S = Math.min(this.W / (2 * HALF_H + 0.16), this.H / 2.95);
    this.invalidate();
  }

  #retarget() {
    const target = this.paused ? PI / 2 : this.base * PI;
    const d = Math.abs(target - this.theta);
    if (d < 1e-6) {
      this.anim = null;
    } else {
      this.anim = { from: this.theta, to: target, t: 0, dur: 0.55 + (0.4 * d) / (PI / 2) };
    }
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
   * @param {number} progress 0 (Sand in der oberen Hälfte) … 1 (ganz unten)
   * @param {boolean} flowing true, wenn die Zeit läuft
   */
  draw(now, progress, flowing) {
    const dt = this.last == null ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.dirty = false;
    this.clock += dt;

    // Drehung des Glases
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const u = Math.min(1, a.t);
      this.theta = a.from + (a.to - a.from) * easeInOut(u);
      if (u >= 1) {
        this.theta = a.to;
        this.anim = null;
      }
    }
    // Der Sand folgt der Schwerkraft mit Verzögerung (zähflüssig)
    this.sandTheta += (this.theta - this.sandTheta) * (1 - Math.exp(-dt * SAND_LAG));
    if (Math.abs(this.sandTheta - this.theta) < 0.002) this.sandTheta = this.theta;
    const calm = !this.anim && Math.abs(this.sandTheta - this.theta) < 0.04;

    if (this.flipPending && calm) {
      this.flipPending = false;
      const cb = this.flipCb;
      this.flipCb = null;
      cb?.();
    }

    // Fortschritt: Der Durchfluss ist konstant, der Füllstand sinkt gleichmäßig
    const canFlow = calm && !this.paused;
    let drain = 0; // in diesem Bild abgeflossenes Volumen
    if (this.settling) {
      if (canFlow) {
        const next = Math.min(1, this.pTrue + SETTLE_RATE * dt);
        drain = (next - this.pTrue) * SAND_AREA;
        this.pTrue = next;
      }
      if (this.pTrue >= 1) this.settling = false;
    } else {
      drain = Math.max(0, progress - this.pTrue) * SAND_AREA;
      this.pTrue = progress;
    }
    const running = (flowing || this.settling) && canFlow && this.pTrue < 1;
    const act = this.#updateSand(drain, dt, running);

    // Rieselstrahl ein-/ausblenden
    this.flowTarget = running ? 1 : 0;
    const k = 1 - Math.exp(-dt * (this.flowTarget ? 10 : 18));
    this.flow += (this.flowTarget - this.flow) * k;
    if (Math.abs(this.flow - this.flowTarget) < 0.004) this.flow = this.flowTarget;
    if (this.flow < 0.01) {
      this.stream.length = 0;
      this.splash.length = 0;
    }

    // Lage der Sanduhr im Bild: Sie steht immer auf dem Boden, wird beim Drehen bei Bedarf kleiner
    const { ctx, W, H, S, dpr } = this;
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    const extW = 2 * (HALF_W * Math.abs(c) + HALF_H * Math.abs(s));
    const extH = 2 * (HALF_W * Math.abs(s) + HALF_H * Math.abs(c));
    const ground = Math.min(H - 0.1 * S, H / 2 + 1.3 * S);
    const sc = Math.min(1, (W - 8) / (extW * S), (ground - 6) / (extH * S));
    const Se = S * sc;
    this.Se = Se;
    this.lt = (1 - c) / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.#drawShadow(W / 2, ground, Math.abs(s), Se);

    const mirror = this.sandTheta > PI / 2;
    const fb = this.base === 0 ? this.pTrue : 1 - this.pTrue; // Anteil des Sandes in der unteren Glashälfte
    const phiS = mirror ? PI - this.sandTheta : this.sandTheta;
    const st = sandState(mirror ? 1 - fb : fb, phiS, this.vc);
    const skew = this.aval ? this.aval.side * 0.45 * Math.sin(PI * Math.min(1, this.aval.t)) : 0;
    if (st.top) st.top.skew = skew;
    this.top = st.top ?? null;
    this.lastDraw = { st, phiS, mirror, act };

    ctx.save();
    ctx.translate(W / 2, ground - (extH / 2) * Se);
    ctx.scale(Se, Se);
    ctx.rotate(this.theta);
    this.#drawPosts();
    this.#drawGlassBack();
    this.#drawSand(st, phiS, mirror, act, dt);
    this.#drawGlassFront();
    this.#drawPlates();
    ctx.restore();
  }

  /**
   * Prüfhilfe: Fläche des Sandes (Einheiten², wie im Bild gezeichnet) getrennt nach Quelle
   * (oberer Sand) und Ziel (unterer Sand). Rendert den Sand ohne Strahl in ein eigenes Canvas.
   */
  measureSand() {
    if (!this.lastDraw) return null;
    const { st, phiS, mirror, act } = this.lastDraw;
    const size = 480;
    const sc = size / 2.4;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d', { willReadFrequently: true });
    const out = {};
    for (const [name, b, clipTop, seed] of [['source', st.top, true, 1], ['sink', st.bottom, false, 7]]) {
      if (!b) { out[name] = 0; continue; }
      g.clearRect(0, 0, size, size);
      g.save();
      g.translate(size / 2, size / 2);
      g.scale(sc, sc);
      if (mirror) g.scale(1, -1);
      g.clip(this.innerPath);
      g.beginPath();
      if (clipTop) g.rect(-1.5, -1.5, 3, 1.515);
      else g.rect(-1.5, 0, 3, 1.5);
      g.clip();
      const { pts } = this.#surface(b, phiS, seed, act);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = '#fff';
      g.fill();
      g.restore();
      const d = g.getImageData(0, 0, size, size).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
      out[name] = sum / 255 / (sc * sc);
    }
    return out;
  }

  #drawShadow(cx, ground, lying, Se) {
    const { ctx } = this;
    const rx = (0.95 + 0.3 * lying) * Se;
    const ry = 0.09 * Se;
    const lift = 1 - 0.35 * Math.sin(PI * lying);
    ctx.save();
    ctx.translate(cx, ground + 0.01 * Se);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${0.55 * lift})`);
    g.addColorStop(0.65, `rgba(0,0,0,${0.28 * lift})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #drawPosts() {
    const { ctx, lt } = this;
    const w = 0.075;
    for (const sx of [-1, 1]) {
      const x = sx * POST_X - w / 2;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#2b170a');
      g.addColorStop(0.28, rgb(mixv([140, 92, 48], [100, 64, 31], lt)));
      g.addColorStop(0.5, '#a8743e');
      g.addColorStop(0.72, rgb(mixv([100, 64, 31], [140, 92, 48], lt)));
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
    const { ctx, light } = this;
    const g = ctx.createLinearGradient(-R, 0, R, 0);
    if (light) {
      g.addColorStop(0, 'rgba(110,150,200,0.22)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.3)');
      g.addColorStop(1, 'rgba(110,150,200,0.22)');
    } else {
      g.addColorStop(0, 'rgba(150,200,255,0.17)');
      g.addColorStop(0.4, 'rgba(210,235,255,0.05)');
      g.addColorStop(0.6, 'rgba(210,235,255,0.05)');
      g.addColorStop(1, 'rgba(150,200,255,0.17)');
    }
    ctx.fillStyle = g;
    ctx.fill(this.glassPath);
  }

  #sandFill() {
    const t = this.lt;
    const g = this.ctx.createLinearGradient(-R, 0, R, 0);
    g.addColorStop(0, '#85602a');
    g.addColorStop(0.25, rgb(mixv([214, 174, 96], [207, 164, 82], t)));
    g.addColorStop(0.5, '#ecc983');
    g.addColorStop(0.75, rgb(mixv([207, 164, 82], [214, 174, 96], t)));
    g.addColorStop(1, '#85602a');
    return g;
  }

  /**
   * Sandverlauf und Bewegung der Oberfläche.
   * drain: in diesem Bild abgeflossenes Volumen, running: Sand rieselt gerade.
   * Gibt die Lawinenaktivität (0…1) zurück, mit der die Oberfläche stärker flimmert.
   */
  #updateSand(drain, dt, running) {
    // Die Mulde oben sammelt (als Fläche im Bild), was in der Mitte abfließt
    this.vc += drain;
    const top = this.top;
    let ratio = 0;
    if (top && top.amp > 0) {
      ratio = top.w / innerRadius(Math.min(1, Math.abs(top.L)));
      // Was die Geometrie nicht mehr darstellen kann (Wand, Hals), zählt nicht weiter
      const shown = top.w * top.amp;
      if (ratio > 0.93 || -top.L - top.amp < 0.052) this.vc = Math.min(this.vc, shown);
    }
    if (running) this.sinceAval += dt;

    if (this.aval) {
      // Lawine: Sand rutscht vom Rand in die Mulde, sie läuft zusammen
      const a = this.aval;
      a.t += dt / a.dur;
      const u = Math.min(1, a.t);
      const e = u * u * (3 - 2 * u);
      this.vc -= a.total * (e - a.e);
      a.e = e;
      if (u >= 1) {
        this.aval = null;
        this.sinceAval = 0;
      }
    } else if (running && top && top.amp > 0.03 && this.sinceAval > 1.2
      && (ratio > this.trigger || (this.sinceAval > this.timeTrigger && ratio > 0.28))) {
      // Kritische Neigung erreicht (oder zufällig früher): Teil der Mulde füllt sich wieder
      const big = ratio > this.trigger;
      const keep = big ? 0.02 + Math.random() * 0.13 : 0.2 + Math.random() * 0.3;
      this.aval = {
        total: this.vc * (1 - keep),
        e: 0,
        t: 0,
        dur: (big ? 0.7 : 0.45) + Math.random() * 0.6,
        side: Math.random() < 0.5 ? -1 : 1,
      };
      this.trigger = 0.38 + Math.random() * 0.32;
      this.timeTrigger = 6 + Math.random() * 12;
    }
    this.vc = Math.max(0, this.vc);

    // Körner rutschen in Wellen über den Sandkegel unten
    if (running) {
      this.nextRipple -= dt;
      if (this.nextRipple <= 0) {
        this.ripples.push({ side: Math.random() < 0.5 ? -1 : 1, t: 0, dur: 0.9 + Math.random() * 0.7, amp: 0.012 + Math.random() * 0.012 });
        this.nextRipple = 0.5 + Math.random() * 1.8;
      }
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      if (r.t > r.dur) this.ripples.splice(i, 1);
    }
    return this.aval ? Math.sin(PI * Math.min(1, this.aval.t)) : 0;
  }

  /**
   * Oberfläche eines Sandhaufens als Punktliste in Glaskoordinaten.
   * Die Form (Ebene, Mulde, Kegel) bestimmt die Sandfläche. Alles, was die Oberfläche belebt
   * (Rauschen, Wellen, Körner), wird so verschoben, dass es im Mittel keine Fläche hinzufügt.
   */
  #surface(b, phi, seed, act) {
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    const skew = b.skew ?? 0;
    const finite = b.finite;
    const n = finite ? 60 : 300;
    const U0 = finite ? b.uc - b.w : -1.45;
    const U1 = finite ? b.uc + b.w : 1.45;
    const jAmp = 0.011 * (1 + 1.5 * act);
    const waveAmp = 0.0045 * (1 + 1.5 * act);
    const chordHalf = phi < 0.3 ? innerRadius(Math.min(1, Math.abs(b.L) / Math.max(cs, 0.3))) : R;

    const us = [];
    const h0 = []; // Grundform
    const pert = []; // Belebung
    for (let i = 0; i <= n; i++) {
      const u = U0 + ((U1 - U0) * i) / n;
      const du = u - b.uc;
      let base = 0;
      let p = 0;
      if (b.amp > 1e-6) {
        // Mulde; die Seiten können beim Rutschen ungleich breit sein (Fläche bleibt w · d)
        const rho = du < 0 ? -du / (b.w * (1 + skew)) : du / (b.w * (1 - skew));
        if (rho < 1) {
          base = b.amp * (1 - rho);
          // Eine dünne Schicht Körner rutscht stetig zur Mitte
          p += waveAmp * Math.sin(2 * PI * (3.2 * rho + 0.8 * this.clock)) * 4 * rho * (1 - rho);
        }
      } else if (b.amp < -1e-6) {
        const rho = Math.abs(du) / b.w;
        if (rho < 1) {
          base = b.amp * (1 - rho);
          // Lawinen an den Flanken: vorn häufen sich Körner an, dahinter entsteht eine Delle
          for (const r of this.ripples) {
            if (r.side * du < 0) continue;
            const pos = r.t / r.dur;
            const g = (rho - pos) / 0.13;
            const env = Math.sin(PI * Math.min(1, pos * 1.3 + 0.2)) * (1 - 0.5 * pos);
            p -= r.amp * 1.6 * g * Math.exp(-g * g) * env;
          }
        }
      }
      p += (vnoise(i * 0.35 + seed * 13) - 0.5) * jAmp;
      if (finite && (i === 0 || i === n)) p = 0;
      us.push(u);
      h0.push(base);
      pert.push(p);
    }
    // Mittelwert der Belebung im Glas abziehen: sie darf keinen Sand erzeugen oder vernichten
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i <= n; i++) {
      if (finite ? i > 0 && i < n : Math.abs(us[i]) <= chordHalf) {
        sum += pert[i];
        cnt++;
      }
    }
    const mean = cnt ? sum / cnt : 0;

    const pts = [];
    const add = (u, v) => pts.push([u * cs + v * sn, -u * sn + v * cs]);
    if (finite) {
      add(U0, b.L + 0.6);
      for (let i = 0; i <= n; i++) {
        add(us[i], b.L + h0[i] + (i > 0 && i < n ? pert[i] - mean : 0));
      }
      add(U1, b.L + 0.6);
    } else {
      add(U0, b.L + 3);
      for (let i = 0; i <= n; i++) add(us[i], b.L + h0[i] + pert[i] - mean);
      add(U1, b.L + 3);
    }
    return { pts, surfaceFrom: 1, surfaceTo: n + 2 };
  }

  #drawBulbSand(b, phi, clipTop, seed, act) {
    const { ctx } = this;
    const { pts, surfaceFrom, surfaceTo } = this.#surface(b, phi, seed, act);
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
    this.grain.setTransform(new DOMMatrix().scale(0.75 / this.Se));
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

  #drawSand(st, phi, mirror, act, dt) {
    const { ctx } = this;
    ctx.save();
    ctx.clip(this.innerPath);
    ctx.save();
    if (mirror) ctx.scale(1, -1); // gespiegeltes Glas: oben ist die Quelle, unten die Mulde
    if (st.top) this.#drawBulbSand(st.top, phi, true, 1, act);
    if (st.bottom) this.#drawBulbSand(st.bottom, phi, false, 7, act);

    // weiche Schattierung zum Glasrand hin
    const shade = ctx.createLinearGradient(-R, 0, R, 0);
    shade.addColorStop(0, 'rgba(20,10,0,0.29)');
    shade.addColorStop(0.18, 'rgba(20,10,0,0)');
    shade.addColorStop(0.82, 'rgba(20,10,0,0)');
    shade.addColorStop(1, 'rgba(20,10,0,0.29)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = shade;
    ctx.fillRect(-R, -1, 2 * R, 2);
    ctx.globalCompositeOperation = 'source-over';

    if (this.flow > 0.004) this.#drawStream(st.bottom, phi, dt);
    ctx.restore();
    ctx.restore();
  }

  /** Strahl aus einzelnen Körnern: Sand reißt ab, klumpt und fällt beschleunigt */
  #drawStream(b, phi, dt) {
    const { ctx } = this;
    const apex = b ? toLocal(b.uc, b.L + b.amp, phi) : { x: 0, y: 0.98 };
    const apexY = Math.min(0.99, apex.y);
    const y0 = -0.03;
    const n1 = vnoise(this.clock * 2.1);
    const n2 = vnoise(this.clock * 5.3 + 10);
    const gap = n1 < 0.12; // kurz dünner Strahl, einzelne Körner lösen sich
    const flux = 0.82 + 0.3 * n1 + 0.15 * n2; // der Durchfluss ist praktisch konstant

    // neue Körner
    this.spawnAcc += (gap ? 18 : 95 * flux) * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      this.stream.push({
        x: (Math.random() - 0.5) * 0.008,
        y: y0,
        v: 0.2 + Math.random() * 0.12,
        r: 0.0032 + Math.random() * 0.0028,
        c: Math.random() > 0.5,
      });
    }
    // Körner fallen und schlagen auf dem Kegel auf
    for (let i = this.stream.length - 1; i >= 0; i--) {
      const p = this.stream[i];
      p.v += GRAVITY * dt;
      p.y += p.v * dt;
      if (p.y >= apexY) {
        this.stream.splice(i, 1);
        if (Math.random() < 0.4) {
          this.splash.push({
            x: apex.x + (Math.random() - 0.5) * 0.02,
            y: apexY,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -(0.08 + Math.random() * 0.14),
            life: 0.25 + Math.random() * 0.2,
            t: 0,
          });
        }
      }
    }
    for (let i = this.splash.length - 1; i >= 0; i--) {
      const p = this.splash[i];
      p.t += dt;
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t > p.life || p.y > apexY + 0.02) this.splash.splice(i, 1);
    }

    ctx.save();
    ctx.globalAlpha = this.flow;
    ctx.fillStyle = 'rgba(232,198,120,0.9)';
    // dünner, sich verdickender Faden mit wandernden Klumpen
    const top = y0;
    const len = apexY - top;
    if (len > 0.02) {
      const base = gap ? 0.0016 : 0.0034 + 0.0035 * flux;
      const seg = 28;
      const left = [];
      const right = [];
      for (let i = 0; i <= seg; i++) {
        const f = i / seg;
        const y = top + len * f;
        const w = base * (0.45 + 1.1 * vnoise(y * 26 - this.clock * 6)) * (0.7 + 0.5 * f);
        left.push([-w, y]);
        right.push([w, y]);
      }
      ctx.globalAlpha = this.flow * (gap ? 0.45 : 0.85);
      ctx.beginPath();
      left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      right.reverse().forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = this.flow;
    for (const p of this.stream) {
      ctx.fillStyle = p.c ? 'rgba(250,228,165,0.95)' : 'rgba(205,165,85,0.95)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(236,205,130,0.85)';
    for (const p of this.splash) {
      ctx.globalAlpha = this.flow * (1 - p.t / p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.0038, 0, PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #streak(side, y0, y1, width, alpha) {
    const { ctx } = this;
    if (alpha < 0.005) return;
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
    const { ctx, light } = this;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = light ? 'rgba(60,85,120,0.6)' : 'rgba(205,230,255,0.38)';
    ctx.stroke(this.glassPath);
    ctx.lineWidth = 0.006;
    ctx.strokeStyle = light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
    ctx.stroke(this.innerPath);

    // Reflexe: Das Licht kommt von links, sie bleiben beim Umdrehen auf derselben Bildseite
    const a = 1 - this.lt; // 1 aufrecht, 0 umgedreht
    for (const [y0, y1, w, al] of [[-0.92, -0.16, 0.04, 0.28], [0.16, 0.92, 0.04, 0.28], [-0.97, -0.9, 0.05, 0.12], [0.9, 0.97, 0.05, 0.12]]) {
      this.#streak(-1, y0, y1, w, al * a);
      this.#streak(1, y0, y1, w, al * (1 - a));
    }
    for (const [y0, y1] of [[-0.8, -0.2], [0.2, 0.8]]) {
      this.#streak(1, y0, y1, 0.016, 0.14 * a);
      this.#streak(-1, y0, y1, 0.016, 0.14 * (1 - a));
    }
  }

  #drawPlates() {
    const { ctx, lt } = this;
    for (const top of [true, false]) {
      const y = top ? -1.14 : 1.0;
      const h = 0.14;
      // Beide Platten sind gleich und von oben beleuchtet; beim Umdrehen wechselt der Verlauf
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, rgb(mixv(BRIGHT, DARK, lt)));
      g.addColorStop(0.5, rgb(MID));
      g.addColorStop(1, rgb(mixv(DARK, BRIGHT, lt)));
      ctx.fillStyle = g;
      roundRect(ctx, -HALF_W, y, 2 * HALF_W, h, 0.035);
      ctx.fill();
      // Maserung
      ctx.strokeStyle = 'rgba(40,20,8,0.22)';
      ctx.lineWidth = 0.004;
      for (let i = 0; i < 6; i++) {
        const gy = y + 0.02 + hash(i * 3 + 1) * (h - 0.04);
        ctx.beginPath();
        ctx.moveTo(-HALF_W + 0.04, gy);
        ctx.lineTo(HALF_W - 0.04, gy + (hash(i) - 0.5) * 0.01);
        ctx.stroke();
      }
      // Glanzkante an der oberen Weltkante
      ctx.lineWidth = 0.006;
      for (const [ey, al] of [[y + 0.008, 1 - lt], [y + h - 0.008, lt]]) {
        ctx.strokeStyle = `rgba(255,220,160,${0.4 * al})`;
        ctx.beginPath();
        ctx.moveTo(-HALF_W + 0.04, ey);
        ctx.lineTo(HALF_W - 0.04, ey);
        ctx.stroke();
      }
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
