// ═══════════════════════════════════════════════════
// sound-service.js — Sonidos procedurales Web Audio API
// Sin archivos externos · Mutable · Volumen configurable
// ═══════════════════════════════════════════════════

class SoundService {
  constructor() {
    this._ctx      = null;
    this._muted    = localStorage.getItem('mila_sound_muted') === 'true';
    this._volume   = parseFloat(localStorage.getItem('mila_sound_vol') ?? '0.35');
    // Inicializar contexto tras primer click (política de autoplay)
    document.addEventListener('click', () => this._init(), { once: true });
  }

  _init() {
    if (this._ctx) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { /* browser sin soporte */ }
  }

  get muted()  { return this._muted; }
  get volume() { return this._volume; }

  toggleMute() {
    this._muted = !this._muted;
    localStorage.setItem('mila_sound_muted', this._muted);
    this._emitState();
    return this._muted;
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('mila_sound_vol', this._volume);
  }

  _emitState() {
    document.dispatchEvent(new CustomEvent('sound:state', {
      detail: { muted: this._muted, volume: this._volume }
    }));
  }

  // ── Generador base ────────────────────────────────
  _tone(freq, type, startTime, duration, gain, ctx) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(ctx.destination);
    osc.type     = type;
    osc.frequency.setValueAtTime(freq, startTime);
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(gain * this._volume, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  _play(notes) {
    if (this._muted || !this._ctx) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    const now = this._ctx.currentTime;
    notes.forEach(([delay, freq, type = 'sine', dur = 0.18, gain = 0.6]) => {
      this._tone(freq, type, now + delay, dur, gain, this._ctx);
    });
  }

  // ── Catálogo de sonidos ────────────────────────────

  /** Login exitoso — acorde ascendente alegre */
  login() {
    this._play([
      [0.00, 523, 'sine', 0.14, 0.5],
      [0.10, 659, 'sine', 0.14, 0.5],
      [0.20, 784, 'sine', 0.20, 0.6],
    ]);
  }

  /** Logout — descenso suave */
  logout() {
    this._play([
      [0.00, 659, 'sine', 0.16, 0.4],
      [0.12, 523, 'sine', 0.22, 0.3],
    ]);
  }

  /** Nueva reserva — fanfarria corta */
  newBooking() {
    this._play([
      [0.00, 440, 'triangle', 0.10, 0.5],
      [0.08, 554, 'triangle', 0.10, 0.55],
      [0.16, 659, 'triangle', 0.10, 0.6],
      [0.24, 880, 'triangle', 0.22, 0.7],
    ]);
  }

  /** Éxito / guardado correcto */
  success() {
    this._play([
      [0.00, 523, 'sine', 0.12, 0.45],
      [0.10, 784, 'sine', 0.18, 0.5],
    ]);
  }

  /** Error / advertencia */
  error() {
    this._play([
      [0.00, 220, 'square', 0.08, 0.3],
      [0.10, 196, 'square', 0.12, 0.25],
    ]);
  }

  /** Recordatorio — campana suave */
  reminder() {
    this._play([
      [0.00, 880, 'sine', 0.08, 0.5],
      [0.05, 1046,'sine', 0.30, 0.4],
      [0.00, 440, 'sine', 0.40, 0.15],
    ]);
  }

  /** Bloqueo de fecha */
  block() {
    this._play([
      [0.00, 180, 'sawtooth', 0.06, 0.35],
      [0.08, 160, 'sawtooth', 0.12, 0.25],
    ]);
  }

  /** Clic / accordion — muy sutil */
  click() {
    this._play([[0.00, 800, 'sine', 0.04, 0.2]]);
  }

  /** Modal abre */
  modalOpen() {
    this._play([
      [0.00, 300, 'sine', 0.06, 0.25],
      [0.05, 600, 'sine', 0.10, 0.2],
    ]);
  }

  /** Modal cierra */
  modalClose() {
    this._play([
      [0.00, 600, 'sine', 0.06, 0.2],
      [0.05, 300, 'sine', 0.10, 0.15],
    ]);
  }

  /** Check-in registrado */
  checkIn() {
    this._play([
      [0.00, 523, 'sine', 0.10, 0.4],
      [0.10, 659, 'sine', 0.10, 0.45],
      [0.20, 784, 'sine', 0.10, 0.5],
      [0.30, 1046,'sine', 0.25, 0.6],
    ]);
  }

  /** Check-out registrado */
  checkOut() {
    this._play([
      [0.00, 784, 'sine', 0.10, 0.5],
      [0.10, 659, 'sine', 0.10, 0.45],
      [0.20, 523, 'sine', 0.25, 0.4],
    ]);
  }

  /** Alerta / notificación urgente */
  alert() {
    this._play([
      [0.00, 880, 'square', 0.06, 0.35],
      [0.10, 880, 'square', 0.06, 0.35],
      [0.20, 880, 'square', 0.12, 0.4],
    ]);
  }
}

export const Sound = new SoundService();
