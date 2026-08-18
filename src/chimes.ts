// ── Chime synthesis ──────────────────────────────────────────────────────────
// Every sound here is generated from oscillators, filters and noise at runtime.
// Nothing is sampled, so adding a voice costs no download size.
//
// A chime is a melody (which notes, in what shape) played in a voice (what the
// instrument sounds like). The two are independent, so any voice can play any
// melody.

export type ChimeEvent = 'advance' | 'warning' | 'complete';

export interface ChimeVoice {
  id: string;
  name: string;
  meth: string;   // how it's synthesised — shown under the name
  tail: number;   // how long one note rings, in seconds
  render: (c: AudioContext, out: AudioNode, f: number, t: number, p: number) => void;
}

export interface ChimeMelody {
  id: string;
  name: string;
  ratios: number[]; // pitch multipliers against the base frequency
  step: number;     // seconds between note onsets
}

export interface ChimeSettings {
  volume: number;
  muted: boolean;
  base: number;                            // base frequency in Hz
  voices: Record<ChimeEvent, string>;
  melodies: Record<ChimeEvent, string>;
  enabled: Record<ChimeEvent, boolean>;
}

// ── Audio plumbing ───────────────────────────────────────────────────────────

let _ctx: AudioContext | null = null;
let _noiseBuf: AudioBuffer | null = null;
let _master: GainNode | null = null;

function getCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  return _ctx;
}

// Safari won't start audio until a user gesture resumes the context.
export function unlockAudio() {
  try { getCtx().resume(); } catch { /* ignore */ }
}

// Everything funnels through a limiter, so no combination of stacked partials
// can produce a painful spike in a classroom.
function bus(c: AudioContext): GainNode {
  if (!_master || _master.context !== c) {
    _master = c.createGain();
    _master.gain.value = 1;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -6;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.15;
    _master.connect(lim);
    lim.connect(c.destination);
  }
  return _master;
}

function noise(c: AudioContext): AudioBufferSourceNode {
  if (!_noiseBuf) {
    const n = c.sampleRate * 2;
    _noiseBuf = c.createBuffer(1, n, c.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = _noiseBuf;
  s.loop = true;
  return s;
}

// ── Synthesis primitives ─────────────────────────────────────────────────────

function tone(c: AudioContext, out: AudioNode, type: OscillatorType,
              f: number, t: number, dur: number, peak: number, atk = 0.005) {
  if (peak <= 0.00002 || f <= 0 || f > 18000) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}

// [ratio, relative gain, relative decay]
type Partial = [number, number, number?];

function parts(c: AudioContext, out: AudioNode, f: number, t: number,
               specs: Partial[], dur: number, peak: number, atk = 0.005) {
  for (const [r, a, ds] of specs) {
    tone(c, out, 'sine', f * r, t, dur * (ds === undefined ? 1 : ds), peak * a, atk);
  }
}

function fm(c: AudioContext, out: AudioNode, f: number, t: number, dur: number,
            peak: number, ratio: number, index: number, idxDecay: number, atk = 0.004) {
  const car = c.createOscillator(), mod = c.createOscillator();
  const mg = c.createGain(), g = c.createGain();
  car.type = 'sine'; mod.type = 'sine';
  car.frequency.value = f;
  mod.frequency.value = f * ratio;
  mg.gain.setValueAtTime(f * index, t);
  mg.gain.exponentialRampToValueAtTime(0.001, t + idxDecay);
  mod.connect(mg); mg.connect(car.frequency);
  car.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  mod.start(t); car.start(t);
  mod.stop(t + dur + 0.05); car.stop(t + dur + 0.05);
}

function nburst(c: AudioContext, out: AudioNode, f: number, t: number,
                dur: number, peak: number, q = 6) {
  const s = noise(c), bp = c.createBiquadFilter(), g = c.createGain();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(f, 16000);
  bp.Q.value = q;
  s.connect(bp); bp.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.start(t); s.stop(t + dur + 0.05);
}

// Bright attack that darkens as it decays — the plucked/struck signature.
// Q stays at or below Butterworth: a resonant biquad under automation goes
// unstable and Chrome resets it mid-note.
function filtered(c: AudioContext, out: AudioNode, type: OscillatorType, f: number,
                  t: number, dur: number, peak: number, fromMul: number, toMul: number) {
  const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
  o.type = type;
  o.frequency.value = f;
  lp.type = 'lowpass';
  lp.Q.value = 0.7071;
  lp.frequency.setValueAtTime(Math.min(f * fromMul, 9000), t);
  lp.frequency.setTargetAtTime(Math.max(f * toMul, 80), t, Math.max(dur * 0.25, 0.05));
  o.connect(lp); lp.connect(g); g.connect(out);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}

// ── Voices ───────────────────────────────────────────────────────────────────

export const CHIME_VOICES: ChimeVoice[] = [
  { id: 'classic', name: 'Sine Bell', meth: 'sine · pure', tail: 0.30,
    render: (c, o, f, t, p) => { tone(c, o, 'sine', f, t, 0.22, p); } },

  { id: 'tubular', name: 'Tubular Bell', meth: 'inharmonic partials', tail: 2.6,
    render: (c, o, f, t, p) => {
      parts(c, o, f * 0.5, t, [[1, .55, 1], [2, .75, .85], [2.76, .5, .7], [5.4, .28, .45], [8.93, .14, .3]], 2.5, p);
    } },

  { id: 'musicbox', name: 'Music Box', meth: 'bright partials · fast', tail: 0.75,
    render: (c, o, f, t, p) => {
      parts(c, o, f, t, [[1, 1, 1], [2, .42, .6], [3.9, .2, .35], [6.1, .08, .22]], 0.65, p);
      nburst(c, o, f * 4, t, 0.012, p * 0.28, 3);
    } },

  { id: 'glock', name: 'Glockenspiel', meth: 'FM · ratio 3', tail: 1.3,
    render: (c, o, f, t, p) => { fm(c, o, f, t, 1.2, p, 3, 2.4, 0.07); tone(c, o, 'sine', f * 2, t, 0.5, p * 0.16); } },

  { id: 'rhodes', name: 'Electric Piano', meth: 'FM · ratio 1', tail: 1.8,
    render: (c, o, f, t, p) => { fm(c, o, f * 0.5, t, 1.7, p * 1.05, 1, 3.2, 0.42, 0.006); } },

  { id: 'vibes', name: 'Vibraphone', meth: 'tremolo · 5 Hz', tail: 2.0,
    render: (c, o, f, t, p) => {
      const trem = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      trem.gain.value = 1; lfo.frequency.value = 5.2; lg.gain.value = 0.34;
      lfo.connect(lg); lg.connect(trem.gain); trem.connect(o);
      lfo.start(t); lfo.stop(t + 2.1);
      parts(c, trem, f, t, [[1, 1, 1], [4, .24, .5], [9.2, .07, .28]], 1.9, p * 0.8);
    } },

  { id: 'marimba', name: 'Marimba', meth: '4th-partial bar', tail: 0.55,
    render: (c, o, f, t, p) => { parts(c, o, f, t, [[1, 1, 1], [4, .3, .45], [10, .08, .25]], 0.42, p); } },

  { id: 'woodblock', name: 'Wood Block', meth: 'filtered noise', tail: 0.20,
    render: (c, o, f, t, p) => {
      nburst(c, o, f * 2.1, t, 0.085, p * 1.15, 9);
      tone(c, o, 'sine', f * 1.4, t, 0.055, p * 0.5, 0.001);
    } },

  { id: 'bowl', name: 'Singing Bowl', meth: 'detuned · beating', tail: 4.2,
    render: (c, o, f, t, p) => {
      const lf = f * 0.5;
      tone(c, o, 'sine', lf, t, 4.0, p * 0.75, 0.06);
      tone(c, o, 'sine', lf * 1.003, t, 4.0, p * 0.7, 0.06);  // ~1.5 Hz beat
      tone(c, o, 'sine', lf * 2.76, t, 2.4, p * 0.3, 0.05);
      tone(c, o, 'sine', lf * 5.4, t, 1.3, p * 0.12, 0.04);
    } },

  { id: 'handdrum', name: 'Hand Drum', meth: 'pitch glide', tail: 0.55,
    render: (c, o, f, t, p) => {
      const os = c.createOscillator(), g = c.createGain();
      os.type = 'sine';
      os.frequency.setValueAtTime(f * 1.8, t);
      os.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.14);
      os.connect(g); g.connect(o);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(p * 1.1, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      os.start(t); os.stop(t + 0.5);
      nburst(c, o, f * 3, t, 0.03, p * 0.35, 2);
    } },

  { id: 'pluck', name: 'Plucked String', meth: 'saw · filter decay', tail: 1.0,
    render: (c, o, f, t, p) => {
      filtered(c, o, 'sawtooth', f, t, 0.85, p * 0.5, 10, 1.2);
      nburst(c, o, f * 5, t, 0.015, p * 0.22, 2);
    } },

  { id: 'glass', name: 'Glass Harmonica', meth: 'slow attack · pure', tail: 1.9,
    render: (c, o, f, t, p) => { parts(c, o, f, t, [[1, 1, 1], [3, .16, .8], [5, .05, .6]], 1.8, p * 0.85, 0.19); } },

  { id: 'steeldrum', name: 'Steel Drum', meth: 'FM · ratio 2', tail: 1.5,
    render: (c, o, f, t, p) => { fm(c, o, f, t, 1.4, p * 0.95, 2, 1.6, 0.22); tone(c, o, 'sine', f * 1.5, t, 0.6, p * 0.18); } },

  { id: 'gong', name: 'Gong', meth: 'noise + inharmonic', tail: 3.6,
    render: (c, o, f, t, p) => {
      const lf = f * 0.4;
      parts(c, o, lf, t, [[1, .8, 1], [1.48, .55, .9], [2.34, .4, .7], [3.1, .28, .55], [4.7, .15, .4]], 3.4, p * 0.8, 0.03);
      nburst(c, o, lf * 3, t, 0.5, p * 0.3, 1.2);
    } },

  { id: 'blip', name: 'Synth Blip', meth: 'filtered square', tail: 0.30,
    render: (c, o, f, t, p) => { filtered(c, o, 'square', f, t, 0.2, p * 0.55, 9, 1.6); } },

  { id: 'windchime', name: 'Wind Chime', meth: 'rod partials', tail: 1.6,
    render: (c, o, f, t, p) => { parts(c, o, f, t, [[1, .7, 1], [2.76, .62, .85], [5.4, .34, .6], [8.93, .16, .4]], 1.5, p * 0.8); } },

  { id: 'kalimba', name: 'Kalimba', meth: 'tine · soft attack', tail: 0.9,
    render: (c, o, f, t, p) => { parts(c, o, f, t, [[1, 1, 1], [2.02, .2, .5], [6.2, .13, .3]], 0.8, p * 0.95, 0.009); } },

  { id: 'celesta', name: 'Celesta', meth: 'octave stack', tail: 1.2,
    render: (c, o, f, t, p) => { parts(c, o, f, t, [[1, 1, 1], [2, .4, .7], [4, .18, .45], [8, .06, .25]], 1.1, p * 0.85); } },
];

// ── Melodies ─────────────────────────────────────────────────────────────────

export const CHIME_MELODIES: ChimeMelody[] = [
  { id: 'single',   name: 'Single',        ratios: [1],                     step: 0.30 },
  { id: 'double',   name: 'Double',        ratios: [1, 1],                  step: 0.30 },
  { id: 'rise3',    name: 'Rising Third',  ratios: [1, 1.25],               step: 0.32 },
  { id: 'rise5',    name: 'Rising Fifth',  ratios: [1, 1.5],                step: 0.32 },
  { id: 'rise8',    name: 'Rising Octave', ratios: [1, 2],                  step: 0.30 },
  { id: 'dingdong', name: 'Ding-Dong',     ratios: [1.25, 1],               step: 0.34 },
  { id: 'fall5',    name: 'Falling Fifth', ratios: [1.5, 1],                step: 0.32 },
  { id: 'triadup',  name: 'Triad Up',      ratios: [1, 1.25, 1.5],          step: 0.26 },
  { id: 'triaddn',  name: 'Triad Down',    ratios: [1.5, 1.25, 1],          step: 0.26 },
  { id: 'arch',     name: 'Arch',          ratios: [1, 1.25, 1.5, 1.25, 1], step: 0.28 },
  { id: 'fanfare',  name: 'Fanfare',       ratios: [1, 1, 1.5, 2],          step: 0.24 },
  { id: 'westm',    name: 'Westminster',   ratios: [1.25, 1, 0.891, 0.667], step: 0.42 },
  { id: 'lowpair',  name: 'Low Pair',      ratios: [0.75, 0.75],            step: 0.38 },
  { id: 'triple',   name: 'Triple Pulse',  ratios: [1, 1, 1],               step: 0.20 },
  { id: 'cascade',  name: 'Cascade',       ratios: [2, 1.5, 1.25, 1],       step: 0.22 },
  { id: 'query',    name: 'Gentle Query',  ratios: [1, 1.122],              step: 0.34 },
];

export const CHIME_EVENTS: { id: ChimeEvent; label: string; hint: string }[] = [
  { id: 'advance',  label: 'Segment change',   hint: 'plays when one segment ends and the next begins' },
  { id: 'warning',  label: '1-minute warning', hint: 'plays with 60 seconds left in a segment' },
  { id: 'complete', label: 'Lesson complete',  hint: 'plays when the whole lesson finishes' },
];

export const CHIME_PITCHES: { hz: number; name: string }[] = [
  { hz: 523.25, name: 'C5' },
  { hz: 659.25, name: 'E5' },
  { hz: 880,    name: 'A5' },
  { hz: 1046.5, name: 'C6' },
  { hz: 1318.5, name: 'E6' },
];

// Sine Bell playing these melodies at A5 is the sound LessonPacer has always
// had, so an existing user hears no change until they pick something else.
export const DEFAULT_CHIMES: ChimeSettings = {
  volume: 1,
  muted: false,
  base: 880,
  voices:   { advance: 'classic', warning: 'classic', complete: 'classic' },
  melodies: { advance: 'rise3',   warning: 'lowpair', complete: 'arch'    },
  enabled:  { advance: true,      warning: true,      complete: true      },
};

export function voiceById(id: string): ChimeVoice {
  return CHIME_VOICES.find(v => v.id === id) ?? CHIME_VOICES[0];
}

export function melodyById(id: string): ChimeMelody {
  return CHIME_MELODIES.find(m => m.id === id) ?? CHIME_MELODIES[2];
}

// ── Playback ─────────────────────────────────────────────────────────────────

/** Plays one voice/melody pair. Returns roughly how long it will sound. */
export function playPair(voiceId: string, melodyId: string, s: ChimeSettings): number {
  const v = voiceById(voiceId), m = melodyById(melodyId);
  let len = m.ratios.length * m.step + v.tail;
  try {
    const c = getCtx();
    const out = c.createGain();
    out.gain.value = s.volume;
    out.connect(bus(c));
    c.resume().then(() => {
      const t0 = c.currentTime + 0.02;
      m.ratios.forEach((r, i) => v.render(c, out, s.base * r, t0 + i * m.step, 0.34));
    });
    setTimeout(() => { try { out.disconnect(); } catch { /* ignore */ } }, (len + 0.4) * 1000);
  } catch { /* ignore */ }
  return len;
}

export function playChime(event: ChimeEvent, s: ChimeSettings) {
  if (s.muted || !s.enabled[event]) return;
  playPair(s.voices[event], s.melodies[event], s);
}
