// Geometrie der Sanduhr und Sandverteilung (ohne DOM, testbar in Node).
//
// Einheiten: Das Glas liegt in y ∈ [-1, 1] (y zeigt nach unten), die Achse ist x = 0.
// Oberer Kolben: y < 0, unterer Kolben: y > 0, Hals bei y = 0.
//
// Der Sand wird "gravitationsrichtig" modelliert: Seine Oberfläche ist eine Ebene
// senkrecht zur Schwerkraft. Das Glas ist um den Winkel phi gekippt, also zeigt die
// Schwerkraft im Glas-Koordinatensystem in Richtung g = (sin phi, cos phi).
// Aufrecht (phi = 0) kommen eine Mulde im oberen und ein Schüttkegel im unteren
// Kolben dazu; beide verschwinden, wenn die Sanduhr auf die Seite kippt.
//
// Erhalten wird die sichtbare Fläche der Sandsilhouette (nicht das 3D-Volumen). Nur so ändert
// sich das Bild beim Nachrutschen nicht scheinbar durch zusätzlichen oder fehlenden Sand.

export const R = 0.62; // maximaler Radius der Kolben
export const NECK = 0.045; // Halsradius
export const WALL = 0.016; // Glasstärke
export const FILL = 0.46; // Sandmenge als Anteil der Kolbenfläche
export const REPOSE = Math.tan((34 * Math.PI) / 180); // Böschungswinkel

const N = 480; // Stützstellen pro Kolben
const EPS_PHI = 0.002;
const FEATURE_FADE = 0.3; // Kippwinkel (rad), bei dem Mulde/Kegel verschwunden sind

export function radius(y) {
  const t = Math.min(1, Math.abs(y));
  if (t <= 0.5) {
    const u = t / 0.5;
    return NECK + (R - NECK) * Math.sin((u * Math.PI) / 2) ** 1.5;
  }
  const u = (t - 0.5) / 0.5;
  return R * (1 - 0.42 * u ** 2.2);
}

/** Radius der Innenseite des Glases, so weit reicht der Sand */
export function innerRadius(y) {
  return Math.max(radius(y) - WALL, 0.012);
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
const RT = new Float64Array(N + 1); // Innenradius
const CUM = new Float64Array(N + 1); // Fläche von t = 0 bis t
for (let i = 0; i <= N; i++) {
  T[i] = i / N;
  RT[i] = innerRadius(T[i]);
}
for (let i = 1; i <= N; i++) {
  CUM[i] = CUM[i - 1] + (RT[i - 1] + RT[i]) / N; // Breite 2·r, trapezförmig integriert
}

export const BULB_AREA = CUM[N];
export const SAND_AREA = FILL * BULB_AREA;

function cumAt(t) {
  if (t <= 0) return 0;
  if (t >= 1) return BULB_AREA;
  const x = t * N;
  const i = Math.floor(x);
  return CUM[i] + (CUM[i + 1] - CUM[i]) * (x - i);
}

/**
 * Sandfläche eines Kolbens unterhalb der Ebene v = L (v = Position · Schwerkraft).
 * sign: -1 oberer Kolben, +1 unterer Kolben.
 */
export function planeArea(sign, phi, L) {
  if (phi < EPS_PHI) {
    if (sign < 0) return cumAt(-L);
    return BULB_AREA - cumAt(L);
  }
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  // Für jede Höhe y: Länge der Sehne [-r, r], die auf der Sandseite der Ebene liegt
  const chord = (i) => {
    const r = RT[i];
    const xmin = (L - sign * T[i] * cs) / sn;
    if (xmin >= r) return 0;
    return r - Math.max(xmin, -r);
  };
  let prev = chord(0);
  let sum = 0;
  for (let i = 1; i <= N; i++) {
    const cur = chord(i);
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

function solveBulb(sign, A, phi, progress, craterArea) {
  if (A < 1e-5) return null;
  const sn = Math.sin(phi);
  const cs = Math.max(Math.cos(phi), 1e-3);
  const k = Math.max(0, 1 - phi / FEATURE_FADE); // 1 aufrecht … 0 gekippt
  // Ohne Vorgabe fließt alles Abgeflossene in die Mulde
  const crater = (craterArea ?? SAND_AREA * progress) * k;
  const [lo0, hi0] = vRange(sign, sn, cs);

  // Mulde (oben) bzw. Kegel (unten) relativ zur Sandebene, jeweils als Dreieck im Schnitt
  const feature = (L) => {
    const tc = Math.min(1, Math.max(0, (sign * L) / cs));
    const w = innerRadius(tc);
    if (sign < 0) {
      // Mulde im Böschungswinkel: Fläche = Breite · Tiefe (Dreieck mit Grundseite 2·wc), also
      // d = √(Fläche · tan). Sie bleibt innerhalb der Glaswand und endet oberhalb des Halses.
      const ac = Math.min(crater, 0.8 * A);
      let d = Math.sqrt(ac * REPOSE);
      d = Math.min(d, Math.max(0, tc - 0.05), 0.96 * w * REPOSE);
      const wc = d / REPOSE;
      return { w: wc, amp: d, area: -wc * d };
    }
    const h = k * REPOSE * w;
    return { w, amp: -h, area: w * h };
  };

  // Wenig Sand unten: nur ein kleiner Kegel auf dem Boden, keine ebene Fläche
  if (sign > 0 && k > 0) {
    const atFloor = planeArea(sign, phi, hi0) + feature(hi0).area - A;
    if (atFloor >= 0) {
      const rc = Math.sqrt(A / (k * REPOSE));
      return { L: cs, uc: -sn, w: rc, amp: -k * REPOSE * rc, finite: true };
    }
  }

  let lo = lo0;
  let hi = hi0;
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi);
    const g = planeArea(sign, phi, mid) + feature(mid).area - A;
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
 * von Mulde/Kegel, dessen Radius w und Tiefe amp (> 0 Mulde, < 0 Kegel).
 * craterArea (optional) ist die Fläche der Mulde im oberen Kolben, sonst das bisher Abgeflossene.
 */
export function sandState(progress, phi, craterArea) {
  const p = Math.min(1, Math.max(0, progress));
  return {
    top: solveBulb(-1, SAND_AREA * (1 - p), phi, p, craterArea),
    bottom: solveBulb(1, SAND_AREA * p, phi, p),
  };
}

/** Schwerkraftkoordinaten (u, v) → Glaskoordinaten (x, y). */
export function toLocal(u, v, phi) {
  const sn = Math.sin(phi);
  const cs = Math.cos(phi);
  return { x: u * cs + v * sn, y: -u * sn + v * cs };
}
