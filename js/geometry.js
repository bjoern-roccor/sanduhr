// Geometrie der Sanduhr und Sandverteilung (ohne DOM, testbar in Node).
//
// Einheiten: Das Glas liegt in y ∈ [-1, 1] (y zeigt nach unten), die Achse ist x = 0.
// Oberer Kolben: y < 0, unterer Kolben: y > 0, Hals bei y = 0.
//
// Der Sand wird "gravitationsrichtig" modelliert: Seine Oberfläche ist eine Ebene
// senkrecht zur Schwerkraft. Das Glas ist um den Winkel phi gekippt, also zeigt die
// Schwerkraft im Glas-Koordinatensystem in Richtung g = (sin phi, cos phi).
// Aufrecht (phi = 0) kommen ein Trichter im oberen und ein Schüttkegel im unteren
// Kolben dazu; beide verschwinden, wenn die Sanduhr auf die Seite kippt.

export const R = 0.62; // maximaler Radius der Kolben
export const NECK = 0.045; // Halsradius
export const WALL = 0.016; // Glasstärke
export const FILL = 0.46; // Sandmenge als Anteil des Kolbenvolumens
export const REPOSE = Math.tan((34 * Math.PI) / 180); // Böschungswinkel

const N = 480; // Stützstellen pro Kolben
const EPS_PHI = 0.002;
const FEATURE_FADE = 0.3; // Kippwinkel (rad), bei dem Trichter/Kegel verschwunden sind

export function radius(y) {
  const t = Math.min(1, Math.abs(y));
  if (t <= 0.5) {
    const u = t / 0.5;
    return NECK + (R - NECK) * Math.sin((u * Math.PI) / 2) ** 1.5;
  }
  const u = (t - 0.5) / 0.5;
  return R * (1 - 0.42 * u ** 2.2);
}

/** Umriss des Glases als Polygon; inset verkleinert ihn (Innenseite des Glases). */
export function outline(inset = 0, n = 200) {
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const y = -1 + (2 * i) / n;
    const r = Math.max(radius(y) - inset, 0.012);
    left.push([-r, y]);
    right.push([r, y]);
  }
  return [...left, ...right.reverse()];
}

// Tabellen entlang der Entfernung t vom Hals (0) zum Kolbenende (1)
const T = new Float64Array(N + 1);
const RT = new Float64Array(N + 1);
const CUM = new Float64Array(N + 1); // Volumen von t = 0 bis t
for (let i = 0; i <= N; i++) {
  T[i] = i / N;
  RT[i] = radius(T[i]);
}
for (let i = 1; i <= N; i++) {
  CUM[i] = CUM[i - 1] + (0.5 * Math.PI * (RT[i - 1] ** 2 + RT[i] ** 2)) / N;
}

export const BULB_VOLUME = CUM[N];
export const SAND_VOLUME = FILL * BULB_VOLUME;

function cumAt(t) {
  if (t <= 0) return 0;
  if (t >= 1) return BULB_VOLUME;
  const x = t * N;
  const i = Math.floor(x);
  return CUM[i] + (CUM[i + 1] - CUM[i]) * (x - i);
}

function segmentArea(r, d) {
  // Fläche des Kreises (Radius r), die rechts der Sehne x = d liegt
  if (d <= -r) return Math.PI * r * r;
  if (d >= r) return 0;
  return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
}

/**
 * Sandvolumen eines Kolbens unterhalb der Ebene v = L (v = Position · Schwerkraft).
 * sign: -1 oberer Kolben, +1 unterer Kolben.
 */
export function planeVolume(sign, phi, L) {
  if (phi < EPS_PHI) {
    if (sign < 0) return cumAt(-L);
    return BULB_VOLUME - cumAt(L);
  }
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  let prev = segmentArea(RT[0], (L - 0) / sn);
  let sum = 0;
  for (let i = 1; i <= N; i++) {
    const d = (L - sign * T[i] * cs) / sn;
    const cur = segmentArea(RT[i], d);
    sum += 0.5 * (prev + cur);
    prev = cur;
  }
  return sum / N;
}

function vRange(sign, sn, cs) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= N; i += 4) {
    const y = sign * T[i];
    lo = Math.min(lo, y * cs - RT[i] * sn);
    hi = Math.max(hi, y * cs + RT[i] * sn);
  }
  return [lo, hi];
}

function solveBulb(sign, V, phi, progress) {
  if (V < 1e-5) return null;
  const sn = Math.sin(phi);
  const cs = Math.max(Math.cos(phi), 1e-3);
  const k = Math.max(0, 1 - phi / FEATURE_FADE); // 1 aufrecht … 0 gekippt
  // Der Trichter kann nur so viel Volumen haben, wie schon abgeflossen ist
  const drained = SAND_VOLUME * progress;
  const [lo0, hi0] = vRange(sign, sn, cs);

  // Trichter (oben) bzw. Kegel (unten) relativ zur Sandebene
  const feature = (L) => {
    const tc = Math.min(1, Math.max(0, (sign * L) / cs));
    const w = radius(tc);
    if (sign < 0) {
      const dFull = k * Math.min(REPOSE * w, 0.8 * tc);
      const vol = Math.min((Math.PI / 3) * w * w * dFull, k * drained);
      return { w, amp: (3 * vol) / (Math.PI * w * w), vol: -vol };
    }
    const h = k * REPOSE * w;
    return { w, amp: -h, vol: (Math.PI / 3) * w * w * h };
  };

  // Wenig Sand unten: nur ein kleiner Kegel auf dem Boden, keine ebene Fläche
  if (sign > 0 && k > 0) {
    const atFloor = planeVolume(sign, phi, hi0) + feature(hi0).vol - V;
    if (atFloor >= 0) {
      const rc = Math.cbrt((3 * V) / (Math.PI * k * REPOSE));
      return { L: cs, uc: -sn, w: rc, amp: -k * REPOSE * rc, finite: true };
    }
  }

  let lo = lo0;
  let hi = hi0;
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi);
    const g = planeVolume(sign, phi, mid) + feature(mid).vol - V;
    if (g > 0) lo = mid;
    else hi = mid;
  }
  const L = 0.5 * (lo + hi);
  const f = feature(L);
  return { L, uc: -(L / cs) * sn, w: f.w, amp: f.amp, finite: false };
}

/**
 * Sandzustand für Fortschritt 0…1 und Kippwinkel phi (0 aufrecht, π/2 liegend).
 * Jeder Kolben liefert die Sandebene L (in Schwerkraftkoordinaten (u, v)), die Mitte uc
 * von Trichter/Kegel, dessen Radius w und Tiefe amp (> 0 Trichter, < 0 Kegel).
 */
export function sandState(progress, phi) {
  const p = Math.min(1, Math.max(0, progress));
  return {
    top: solveBulb(-1, SAND_VOLUME * (1 - p), phi, p),
    bottom: solveBulb(1, SAND_VOLUME * p, phi, p),
  };
}

/** Schwerkraftkoordinaten (u, v) → Glaskoordinaten (x, y). */
export function toLocal(u, v, phi) {
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  return { x: u * cs + v * sn, y: -u * sn + v * cs };
}
