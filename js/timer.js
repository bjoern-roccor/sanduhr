// Reine Timer-Logik ohne DOM. Die Zeit wird über Zeitstempel berechnet,
// nicht über gezählte Ticks, und bleibt auch bei gedrosseltem Rendering korrekt.

export const MIN_SECONDS = 1;
export const MAX_SECONDS = 30 * 60;

export function clampSeconds(total) {
  if (!Number.isFinite(total)) return MIN_SECONDS;
  return Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(total)));
}

export function splitSeconds(total) {
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/** Prüft Minuten/Sekunden-Eingaben. Gültig: 0:01 bis 30:00. */
export function parseDuration(minutes, seconds) {
  const m = Number(minutes);
  const s = Number(seconds);
  if (!Number.isInteger(m) || !Number.isInteger(s)) return { ok: false };
  if (m < 0 || m > 30 || s < 0 || s > 59) return { ok: false };
  const total = m * 60 + s;
  if (total < MIN_SECONDS || total > MAX_SECONDS) return { ok: false };
  return { ok: true, seconds: total };
}

/** "mm:ss", Restzeit wird aufgerundet, damit 0:00 erst bei Ablauf erscheint. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class Timer {
  #now;
  #elapsed = 0;
  #startedAt = 0;

  /** @param {() => number} now Zeitquelle in ms (für Tests austauschbar) */
  constructor(now = () => performance.now()) {
    this.#now = now;
    this.state = 'idle'; // idle | running | paused | finished
    this.durationMs = 0;
  }

  start(seconds) {
    this.durationMs = clampSeconds(seconds) * 1000;
    this.#elapsed = 0;
    this.#startedAt = this.#now();
    this.state = 'running';
  }

  pause() {
    if (this.state !== 'running') return;
    this.#elapsed = this.elapsedMs;
    this.state = 'paused';
  }

  resume() {
    if (this.state !== 'paused') return;
    this.#startedAt = this.#now();
    this.state = 'running';
  }

  reset() {
    this.state = 'idle';
    this.#elapsed = 0;
  }

  get elapsedMs() {
    if (this.state === 'running') {
      return Math.min(this.durationMs, this.#elapsed + (this.#now() - this.#startedAt));
    }
    return this.#elapsed;
  }

  get remainingMs() {
    return this.durationMs - this.elapsedMs;
  }

  /** 0 (voll) … 1 (abgelaufen) */
  get progress() {
    return this.durationMs > 0 ? this.elapsedMs / this.durationMs : 0;
  }

  /** Prüft den Ablauf. Gibt true zurück, genau einmal beim Übergang nach "finished". */
  tick() {
    if (this.state === 'running' && this.elapsedMs >= this.durationMs) {
      this.#elapsed = this.durationMs;
      this.state = 'finished';
      return true;
    }
    return false;
  }
}
