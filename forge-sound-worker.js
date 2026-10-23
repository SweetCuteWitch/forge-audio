// source-hash: 636711846367833247872ebc274959041fb4b224e6ed7e4ef56ab87a0f3b87a5
// src/sound/dsp.ts
var at = (p, i) => typeof p === "number" ? p : p[Math.min(i, p.length - 1)];
var MOD_BLOCK = 32;
var dbToGain = (db2) => 10 ** (db2 / 20);
var gainToDb = (gain) => 20 * Math.log10(Math.max(gain, 1e-9));
function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
var Biquad = class {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  constructor(type, freq, sampleRate, q = 0.7071, gainDb = 0) {
    this.set(type, freq, sampleRate, q, gainDb);
  }
  /** Recomputes the coefficients, keeping the state — usable for sweeps. */
  set(type, freq, sampleRate, q = 0.7071, gainDb = 0) {
    const f = Math.min(Math.max(freq, 10), sampleRate * 0.499);
    const w0 = 2 * Math.PI * f / sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * Math.max(q, 0.01));
    const A = 10 ** (gainDb / 40);
    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;
    switch (type) {
      case "lowpass":
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = (1 - cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = (1 + cos) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "bandpass":
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "notch":
        b0 = 1;
        b1 = -2 * cos;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case "peak":
        b0 = 1 + alpha * A;
        b1 = -2 * cos;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos;
        a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cos + k);
        b1 = 2 * A * (A - 1 - (A + 1) * cos);
        b2 = A * (A + 1 - (A - 1) * cos - k);
        a0 = A + 1 + (A - 1) * cos + k;
        a1 = -2 * (A - 1 + (A + 1) * cos);
        a2 = A + 1 + (A - 1) * cos - k;
        break;
      }
      case "highshelf": {
        const k = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cos + k);
        b1 = -2 * A * (A - 1 + (A + 1) * cos);
        b2 = A * (A + 1 + (A - 1) * cos - k);
        a0 = A + 1 - (A - 1) * cos + k;
        a1 = 2 * (A - 1 - (A + 1) * cos);
        a2 = A + 1 - (A - 1) * cos - k;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  /** One sample through the filter. */
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
};
function filterInPlace(buffer2, filter) {
  for (let i = 0; i < buffer2.length; i++) buffer2[i] = filter.process(buffer2[i]);
}
function filterParamInPlace(buffer2, type, freq, sampleRate, q = 0.7071, gainDb = 0) {
  if (typeof freq === "number" && typeof gainDb === "number") {
    filterInPlace(buffer2, new Biquad(type, freq, sampleRate, q, gainDb));
    return;
  }
  const f = new Biquad(type, at(freq, 0), sampleRate, q, at(gainDb, 0));
  for (let from = 0; from < buffer2.length; from += MOD_BLOCK) {
    const mid = Math.min(buffer2.length - 1, from + MOD_BLOCK / 2);
    if (from > 0) f.set(type, at(freq, mid), sampleRate, q, at(gainDb, mid));
    const end = Math.min(buffer2.length, from + MOD_BLOCK);
    for (let i = from; i < end; i++) buffer2[i] = f.process(buffer2[i]);
  }
}
var DelayLine = class {
  buffer;
  write = 0;
  constructor(maxSamples) {
    this.buffer = new Float32Array(Math.max(2, Math.ceil(maxSamples) + 2));
  }
  /** Reads `delay` samples back (fractions are interpolated linearly). */
  read(delay) {
    const size = this.buffer.length;
    const whole = Math.floor(delay);
    const frac = delay - whole;
    const a = this.buffer[(this.write - whole + size * 2) % size];
    const b = this.buffer[(this.write - whole - 1 + size * 2) % size];
    return a + (b - a) * frac;
  }
  /** Pushes a sample in. */
  push(x) {
    this.buffer[this.write] = x;
    this.write = (this.write + 1) % this.buffer.length;
  }
};
var COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
var ALLPASS_TUNING = [556, 441, 341, 225];
var STEREO_SPREAD = 23;
function reverb(inLeft, inRight, sampleRate, options = {}) {
  const room = Math.min(1, Math.max(0, options.room ?? 0.5));
  const damp = Math.min(1, Math.max(0, options.damp ?? 0.5));
  const width = Math.min(1, Math.max(0, options.width ?? 1));
  const scale = sampleRate / 44100;
  const feedback = room * 0.28 + 0.7;
  const damping = damp * 0.4;
  const n = inLeft.length;
  const preDelay = Math.round((options.preDelayMs ?? 0) / 1e3 * sampleRate);
  const side = (input, spread) => {
    const out = new Float32Array(n);
    const combs = COMB_TUNING.map((t) => ({
      buffer: new Float32Array(Math.round((t + spread) * scale)),
      index: 0,
      store: 0
    }));
    const allpasses = ALLPASS_TUNING.map((t) => ({
      buffer: new Float32Array(Math.round((t + spread) * scale)),
      index: 0
    }));
    for (let i = 0; i < n; i++) {
      const x = (i >= preDelay ? input[i - preDelay] : 0) * 0.015;
      let sum = 0;
      for (const comb of combs) {
        const y = comb.buffer[comb.index];
        comb.store = y * (1 - damping) + comb.store * damping;
        comb.buffer[comb.index] = x + comb.store * feedback;
        comb.index = (comb.index + 1) % comb.buffer.length;
        sum += y;
      }
      for (const ap of allpasses) {
        const buffered = ap.buffer[ap.index];
        const y = -sum + buffered;
        ap.buffer[ap.index] = sum + buffered * 0.5;
        ap.index = (ap.index + 1) % ap.buffer.length;
        sum = y;
      }
      out[i] = sum;
    }
    return out;
  };
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (inLeft[i] + inRight[i]) * 0.5;
  const left = side(mono, 0);
  const right = side(mono, STEREO_SPREAD);
  for (let i = 0; i < n; i++) {
    const mid = (left[i] + right[i]) * 0.5;
    const diff = (left[i] - right[i]) * 0.5 * width;
    left[i] = (mid + diff) * 3;
    right[i] = (mid - diff) * 3;
  }
  return { left, right };
}
function echo(input, sampleRate, options) {
  const delaySamples = Math.max(1, Math.round(options.timeMs / 1e3 * sampleRate));
  const fixed = typeof options.feedback === "number" ? Math.min(0.95, Math.max(0, options.feedback)) : 0;
  const moving = typeof options.feedback === "number" ? null : options.feedback;
  const line = new DelayLine(delaySamples + 2);
  const tone = new Biquad("lowpass", options.tone ?? 4500, sampleRate);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const wet = line.read(delaySamples);
    out[i] = wet;
    const feedback = moving ? Math.min(0.95, Math.max(0, at(moving, i))) : fixed;
    line.push(input[i] + tone.process(wet) * feedback);
  }
  return out;
}
function chorus(input, sampleRate, options = {}) {
  const rate = options.rateHz ?? 0.8;
  const depth = (options.depthMs ?? 6) / 1e3 * sampleRate;
  const base = 0.014 * sampleRate;
  const mix = options.mix ?? 0.5;
  const phase = options.phase ?? 0;
  const line = new DelayLine(base + depth + 4);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    line.push(input[i]);
    const lfo2 = Math.sin(2 * Math.PI * (rate * (i / sampleRate) + phase));
    const wet = line.read(base + depth * 0.5 * (1 + lfo2));
    const m = typeof mix === "number" ? mix : at(mix, i);
    out[i] = input[i] * (1 - m * 0.5) + wet * m;
  }
  return out;
}
function compress(channels, sampleRate, options) {
  const attack = Math.exp(-1 / ((options.attackMs ?? 10) / 1e3 * sampleRate));
  const release = Math.exp(-1 / ((options.releaseMs ?? 120) / 1e3 * sampleRate));
  const knee = options.kneeDb ?? 6;
  const makeup = dbToGain(options.makeupDb ?? 0);
  const n = channels[0]?.length ?? 0;
  let env = 0;
  for (let i = 0; i < n; i++) {
    let level = 0;
    for (const ch of channels) level = Math.max(level, Math.abs(ch[i]));
    env = level > env ? attack * env + (1 - attack) * level : release * env + (1 - release) * level;
    const over = gainToDb(env) - options.thresholdDb;
    let reduction = 0;
    if (2 * over < -knee) reduction = 0;
    else if (2 * Math.abs(over) <= knee) {
      reduction = (1 / options.ratio - 1) * (over + knee / 2) ** 2 / (2 * knee);
    } else reduction = (1 / options.ratio - 1) * over;
    const gain = dbToGain(reduction) * makeup;
    for (const ch of channels) ch[i] *= gain;
  }
}
function limit(channels, ceilingDb = -1) {
  const ceiling = dbToGain(ceilingDb);
  const knee = ceiling * 0.7;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      const a = Math.abs(x);
      if (a <= knee) continue;
      const over = (a - knee) / (ceiling - knee);
      ch[i] = Math.sign(x) * (knee + (ceiling - knee) * Math.tanh(over));
    }
  }
}
function polyBlep(t, dt) {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}
var DRIVE_OVERSAMPLE = 4;
var DRIVE_TAPS = 129;
var DRIVE_CORNER = 0.43;
var DRIVE_KAISER = 8;
var DRIVE_MAX_DB = 30;
var DRIVE_BIAS = 0.3;
var hardClip = (u) => u >= 1 ? 1 : u <= -1 ? -1 : 1.5 * u - 0.5 * u * u * u;
var sineFold = (u) => Math.sin(Math.PI / 2 * u);
var SHAPERS = { soft: Math.tanh, hard: hardClip, fold: sineFold };
function besselI0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}
function kaiserLowpass(taps, corner, beta) {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  const norm = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * corner : Math.sin(2 * Math.PI * corner * t) / (Math.PI * t);
    const r = t / mid;
    h[i] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / norm);
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}
var driveFir = null;
function drive(input, sampleRate, options) {
  const unit2 = (x2) => Math.min(1, Math.max(0, x2));
  const moving = typeof options.amount === "number" ? null : options.amount;
  const amount = moving ? 0 : unit2(options.amount);
  const mixP = options.mix ?? 1;
  const mix = typeof mixP === "number" ? unit2(mixP) : -1;
  if (!moving && (amount === 0 || mix === 0)) return input.slice();
  if (options.low !== void 0) return driveAbove(input, sampleRate, options, options.low);
  const shape = SHAPERS[options.mode ?? "soft"];
  const L = DRIVE_OVERSAMPLE;
  const N = DRIVE_TAPS;
  const h = driveFir ??= kaiserLowpass(N, DRIVE_CORNER / L, DRIVE_KAISER);
  const latency = (N - 1) / L;
  const phaseTaps = Math.ceil(N / L);
  let pre = dbToGain(DRIVE_MAX_DB * amount);
  let bias = DRIVE_BIAS * amount;
  let offset = shape(bias);
  const n = input.length;
  const total2 = n + latency;
  const x = (i) => i >= 0 && i < n ? input[i] : 0;
  const ring = new Float64Array(2 * N);
  let pos = 0;
  const wet = new Float32Array(n);
  for (let k = 0; k < total2; k++) {
    if (moving) {
      const a = unit2(at(moving, Math.max(0, k - latency / 2)));
      pre = dbToGain(DRIVE_MAX_DB * a);
      bias = DRIVE_BIAS * a;
      offset = shape(bias);
    }
    for (let p = 0; p < L; p++) {
      let v = 0;
      for (let q = 0; q < phaseTaps; q++) {
        const j = p + q * L;
        if (j >= N) break;
        v += h[j] * x(k - q);
      }
      const w = shape(pre * L * v + bias) - offset;
      ring[pos] = w;
      ring[pos + N] = w;
      if (p === 0 && k >= latency) {
        let y = 0;
        for (let j = 0; j < N; j++) y += h[j] * ring[pos + N - j];
        wet[k - latency] = y;
      }
      pos = (pos + 1) % N;
    }
  }
  const r = 1 - 2 * Math.PI * 10 / sampleRate;
  const toneP = options.tone ?? 6e3;
  const tone = new Biquad("lowpass", at(toneP, 0), sampleRate);
  let x1 = 0;
  let y1 = 0;
  let eDry = 0;
  let eWet = 0;
  for (let i = 0; i < n; i++) {
    if (typeof toneP !== "number" && i > 0 && i % MOD_BLOCK === 0) tone.set("lowpass", at(toneP, i), sampleRate);
    const blocked = wet[i] - x1 + r * y1;
    x1 = wet[i];
    y1 = blocked;
    const w = tone.process(blocked);
    wet[i] = w;
    eDry += input[i] * input[i];
    eWet += w * w;
  }
  const gain = eWet > 1e-20 && eDry > 0 ? Math.sqrt(eDry / eWet) : 0;
  const out = new Float32Array(n);
  if (mix >= 0) for (let i = 0; i < n; i++) out[i] = input[i] * (1 - mix) + wet[i] * gain * mix;
  else {
    for (let i = 0; i < n; i++) {
      const m = unit2(at(mixP, i));
      out[i] = input[i] * (1 - m) + wet[i] * gain * m;
    }
  }
  return out;
}
function driveAbove(input, sampleRate, options, low) {
  const lp = [new Biquad("lowpass", low, sampleRate), new Biquad("lowpass", low, sampleRate)];
  const hp = [new Biquad("highpass", low, sampleRate), new Biquad("highpass", low, sampleRate)];
  const n = input.length;
  const bottom = new Float32Array(n);
  const top = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    bottom[i] = lp[1].process(lp[0].process(input[i]));
    top[i] = hp[1].process(hp[0].process(input[i]));
  }
  const driven = drive(top, sampleRate, { ...options, low: void 0 });
  for (let i = 0; i < n; i++) driven[i] += bottom[i];
  return driven;
}
var DUCK_ATTACK_MS = 5;
function duckEnvelope(length, sampleRate, hits, options) {
  const g = new Float32Array(length).fill(1);
  const depth = Math.min(1, Math.max(0, options.depth));
  if (depth === 0) return g;
  const floor = Math.max(1 - depth, 1e-3);
  const floorDb = gainToDb(floor);
  const A = Math.max(1, Math.round((options.attackMs ?? DUCK_ATTACK_MS) / 1e3 * sampleRate));
  const R = Math.max(1, Math.round(Math.max(0, options.releaseMs) / 1e3 * sampleRate));
  for (const hit of hits) {
    const from = Math.max(0, hit - A);
    const to = Math.min(length - 1, hit + R);
    for (let i = from; i <= to; i++) {
      let v;
      if (i < hit) {
        const u = (i - (hit - A)) / A;
        v = 1 - (1 - floor) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      } else {
        const u = (i - hit) / R;
        v = dbToGain(floorDb * (1 - u * u * (3 - 2 * u)));
      }
      if (v < g[i]) g[i] = v;
    }
  }
  return g;
}

// src/core/types.ts
var ForgeFormatError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ForgeFormatError";
  }
};

// src/sound/theory.ts
var SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  "natural-minor": [0, 2, 3, 5, 7, 8, 10],
  "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "pentatonic-minor": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
};
var LETTER_SEMITONES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
var MODE_ALIASES = {
  "": "major",
  major: "major",
  maj: "major",
  dur: "major",
  ionian: "major",
  minor: "natural-minor",
  min: "natural-minor",
  m: "natural-minor",
  moll: "natural-minor",
  aeolian: "natural-minor",
  "natural-minor": "natural-minor",
  harmonic: "harmonic-minor",
  "harmonic-minor": "harmonic-minor",
  dorian: "dorian",
  phrygian: "phrygian",
  mixolydian: "mixolydian",
  pentatonic: "pentatonic-minor",
  "pentatonic-minor": "pentatonic-minor",
  blues: "blues"
};
function parseRoot(input) {
  const match = /^([a-g])([#b]?)$/i.exec(input.trim().toLowerCase());
  if (!match) throw new ForgeFormatError(`Cannot parse the tonic: ${input}`);
  const base = LETTER_SEMITONES[match[1]];
  const shift = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return ((base + shift) % 12 + 12) % 12;
}
function parseKey(input) {
  const parts = input.trim().toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) throw new ForgeFormatError("An empty key");
  let rootRaw = parts[0];
  let modeRaw = parts.slice(1).join("-");
  const glued = /^([a-g][#b]?)(m|maj|min)$/i.exec(rootRaw);
  if (glued && modeRaw === "") {
    rootRaw = glued[1];
    modeRaw = glued[2];
  }
  const scale = MODE_ALIASES[modeRaw];
  if (!scale) throw new ForgeFormatError(`Unknown mode: ${modeRaw}`);
  return { root: parseRoot(rootRaw), scale };
}
function degreeToMidi(root, scale, degree, octave, accidental = 0) {
  const steps = SCALES[scale];
  if (!steps) throw new ForgeFormatError(`Unknown scale: ${scale}`);
  const index = Math.round(degree) - 1;
  const octaveShift = Math.floor(index / steps.length);
  const inScale = (index % steps.length + steps.length) % steps.length;
  return 12 * (octave + octaveShift + 1) + root + steps[inScale] + accidental;
}
function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
function nameToMidi(input) {
  const match = /^([a-g][#b]?)(-?\d+)$/i.exec(input.trim().toLowerCase());
  if (!match) throw new ForgeFormatError(`Cannot parse the note: ${input}`);
  return 12 * (Number(match[2]) + 1) + parseRoot(match[1]);
}

// src/sound/instruments.ts
var INSTRUMENTS = {
  lead: { description: "detuned band-limited saws, a filter that opens on the attack, late vibrato", low: 55, high: 96, gm: 81, role: "melody" },
  bass: { description: "a sine sub with a filtered saw on top and a short filter pluck", low: 28, high: 60, gm: 38, role: "bass" },
  pad: { description: "five detuned saws under a slowly moving low-pass, a slow attack and a long release", low: 48, high: 84, gm: 89, role: "harmony" },
  strings: { description: "six detuned saws with vibrato and a bow-like attack: an ensemble", low: 43, high: 91, gm: 48, role: "harmony" },
  brass: { description: "saws with a filter that swells on the attack, like a blown note", low: 40, high: 77, gm: 61, role: "melody" },
  flute: { description: "a sine with soft harmonics, breath noise and late vibrato", low: 60, high: 96, gm: 73, role: "melody" },
  organ: { description: "additive drawbars with a key click", low: 36, high: 84, gm: 16, role: "harmony" },
  epiano: { description: 'FM electric piano: a bright, short "tine" over a warm body', low: 40, high: 88, gm: 4, role: "harmony" },
  bell: { description: "inharmonic partials that die at different speeds", low: 60, high: 100, gm: 14, role: "melody" },
  pluck: { description: "a plucked string (Karplus-Strong): guitar-like, decays in about 2 s", low: 40, high: 84, gm: 25, role: "melody" },
  harp: { description: "a brighter, longer plucked string", low: 36, high: 96, gm: 46, role: "harmony" },
  marimba: { description: "a mallet: a sine with a fast 3.9\xD7 overtone and a knock", low: 48, high: 96, gm: 12, role: "melody" },
  sampler: { description: "plays a WAV you give it, pitched by resampling (--sample file.wav root)", low: 0, high: 127, gm: 0, role: "melody" }
};
function adsr(t, held, a, d, s, r) {
  let level;
  if (t < a) level = a === 0 ? 1 : t / a;
  else if (t < a + d) level = 1 + (s - 1) * ((t - a) / d);
  else level = s;
  if (t > held) {
    const ta = held;
    let atHeld;
    if (ta < a) atHeld = a === 0 ? 1 : ta / a;
    else if (ta < a + d) atHeld = 1 + (s - 1) * ((ta - a) / d);
    else atHeld = s;
    level = atHeld * Math.max(0, 1 - (t - held) / r);
  }
  return level;
}
var cents = (c) => 2 ** (c / 1200);
function total(job, release) {
  return job.samples + Math.ceil(release * job.sampleRate);
}
var SawOsc = class {
  phase;
  constructor(phase = 0) {
    this.phase = phase;
  }
  next(freq, rate) {
    const dt = freq / rate;
    const v = 2 * this.phase - 1 - polyBlep(this.phase, dt);
    this.phase += dt;
    this.phase -= Math.floor(this.phase);
    return v;
  }
};
var CONTROL = 16;
function subtractive(target, offset, job, spec) {
  const rate = job.sampleRate;
  const n = total(job, spec.env[3]);
  const oscs = spec.cents.map(() => new SawOsc(job.rng()));
  const filter = new Biquad("lowpass", 1e3, rate, spec.q);
  const held = job.samples / rate;
  const settled = job.legato ? spec.env[0] + spec.env[1] + 3 * spec.filterDecay : 0;
  let subPhase = 0;
  const velBright = spec.velocityBrightness ?? 0.5;
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    const te = t + settled;
    const amp = adsr(te, held + settled, ...spec.env);
    if (amp <= 0 && t > held) continue;
    let vib = 1;
    if (spec.vibrato && te > spec.vibrato.delay) {
      const ramp = Math.min(1, (te - spec.vibrato.delay) / 0.3);
      vib = cents(Math.sin(2 * Math.PI * spec.vibrato.rate * te) * spec.vibrato.depthCents * ramp);
    }
    if (i % CONTROL === 0) {
      const open = spec.cutoff[2] + (spec.cutoff[1] - spec.cutoff[2]) * Math.exp(-te / spec.filterDecay);
      const closed = spec.cutoff[0];
      let mult = Math.max(closed, open) * (1 - velBright + velBright * (0.5 + job.velocity));
      if (spec.wobble) mult *= 1 + 0.35 * Math.sin(2 * Math.PI * spec.wobble * t);
      filter.set("lowpass", job.freq * mult, rate, spec.q);
    }
    let v = 0;
    for (let k = 0; k < oscs.length; k++) v += oscs[k].next(job.freq * vib * cents(spec.cents[k]), rate);
    v /= Math.sqrt(oscs.length);
    v = filter.process(v);
    if (spec.sub) {
      subPhase += job.freq * vib / rate;
      v += Math.sin(2 * Math.PI * subPhase) * spec.sub;
    }
    if (spec.drive && spec.drive > 1) v = Math.tanh(v * spec.drive) / Math.tanh(spec.drive);
    target[at2] += v * amp * spec.gain * (0.35 + 0.65 * job.velocity);
  }
}
function lead(target, offset, job) {
  subtractive(target, offset, job, {
    cents: [-6, 6],
    gain: 0.5,
    cutoff: [2, 9, 3],
    filterDecay: 0.22,
    q: 0.9,
    env: [0.012, 0.12, 0.75, 0.14],
    vibrato: { rate: 5.5, depthCents: 14, delay: 0.18 },
    sub: 0.18
  });
}
function bass(target, offset, job) {
  subtractive(target, offset, job, {
    cents: [0],
    gain: 0.7,
    cutoff: [2, 9, 3],
    filterDecay: 0.14,
    q: 1.2,
    env: [6e-3, 0.2, 0.7, 0.08],
    sub: 0.7,
    drive: 1.6
  });
}
function pad(target, offset, job) {
  subtractive(target, offset, job, {
    cents: [-14, -7, 0, 7, 14],
    gain: 0.34,
    cutoff: [1.5, 5, 4],
    filterDecay: 0.8,
    q: 0.7,
    env: [0.5, 0.4, 0.85, 1.1],
    wobble: 0.15,
    velocityBrightness: 0.3
  });
}
function strings(target, offset, job) {
  subtractive(target, offset, job, {
    cents: [-10, -6, -2, 3, 7, 11],
    gain: 0.3,
    cutoff: [2, 7, 5],
    filterDecay: 0.3,
    q: 0.6,
    env: [0.22, 0.2, 0.9, 0.45],
    vibrato: { rate: 5.2, depthCents: 8, delay: 0.25 },
    velocityBrightness: 0.4
  });
}
function brass(target, offset, job) {
  subtractive(target, offset, job, {
    cents: [-3, 3],
    gain: 0.45,
    cutoff: [2, 9, 5],
    filterDecay: 0.12,
    q: 0.8,
    env: [0.06, 0.1, 0.85, 0.12],
    vibrato: { rate: 5, depthCents: 10, delay: 0.3 },
    velocityBrightness: 0.7
  });
}
function flute(target, offset, job) {
  const rate = job.sampleRate;
  const n = total(job, 0.15);
  const held = job.samples / rate;
  const breath = new Biquad("bandpass", Math.min(job.freq * 2, rate * 0.4), rate, 2);
  const settled = job.legato ? 0.17 : 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    const amp = adsr(t + settled, held + settled, 0.07, 0.1, 0.85, 0.15);
    const vib = t > 0.25 ? cents(Math.sin(2 * Math.PI * 5 * t) * 8 * Math.min(1, (t - 0.25) / 0.3)) : 1;
    phase += job.freq * vib / rate;
    const tone = Math.sin(2 * Math.PI * phase) + 0.22 * Math.sin(4 * Math.PI * phase) + 0.07 * Math.sin(6 * Math.PI * phase);
    const air = breath.process(job.rng() * 2 - 1) * (0.1 + 0.25 * Math.exp(-t / 0.08));
    target[at2] += (tone * 0.5 + air) * amp * 0.5 * (0.35 + 0.65 * job.velocity);
  }
}
function organ(target, offset, job) {
  const rate = job.sampleRate;
  const n = total(job, 0.05);
  const held = job.samples / rate;
  const ratios = [1, 2, 3, 4, 6, 8];
  const amps = [1, 0.85, 0.55, 0.4, 0.25, 0.18];
  const norm = 1 / amps.reduce((a, b) => a + b, 0);
  const click = new Biquad("highpass", 3e3, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    const amp = adsr(t, held, 6e-3, 0, 1, 0.05);
    phase += job.freq * (1 + 4e-3 * Math.sin(2 * Math.PI * 6.2 * t)) / rate;
    let v = 0;
    for (let k = 0; k < ratios.length; k++) v += Math.sin(2 * Math.PI * phase * ratios[k]) * amps[k];
    v *= norm;
    v += click.process(job.rng() * 2 - 1) * 0.12 * Math.exp(-t / 4e-3);
    target[at2] += v * amp * 0.6 * (0.4 + 0.6 * job.velocity);
  }
}
function epiano(target, offset, job) {
  const rate = job.sampleRate;
  const release = 0.25;
  const n = total(job, release) + Math.round(1.2 * rate);
  const held = job.samples / rate;
  const vel = 0.3 + 0.7 * job.velocity;
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    const decay = Math.exp(-t / (1.6 - 0.8 * Math.min(1, job.freq / 1500)));
    const releaseGain = t > held ? Math.max(0, 1 - (t - held) / release) : 1;
    if (releaseGain <= 0) break;
    const phi = 2 * Math.PI * job.freq * t;
    const body = Math.sin(phi + 1.4 * vel * Math.exp(-t / 0.6) * Math.sin(phi));
    const tine = Math.sin(phi + 2.8 * vel * Math.exp(-t / 0.05) * Math.sin(14 * phi));
    const tremolo = 1 + 0.03 * Math.sin(2 * Math.PI * 4.6 * t);
    target[at2] += (body * 0.65 + tine * 0.28) * decay * releaseGain * tremolo * 0.8 * vel;
  }
}
var BELL_PARTIALS = [
  [0.56, 0.4, 3.5],
  [0.92, 0.7, 3],
  [1.19, 0.6, 2.4],
  [1.71, 0.5, 2],
  [2, 1, 3.2],
  [2.74, 0.45, 1.2],
  [3, 0.4, 1.4],
  [3.76, 0.25, 0.7],
  [4.07, 0.2, 0.6]
];
function bell(target, offset, job) {
  const rate = job.sampleRate;
  const stretch = 1 + Math.min(2, job.samples / rate) * 0.5;
  const n = Math.round(rate * 4.5 * stretch);
  const strike = new Biquad("highpass", 4e3, rate);
  const detune = BELL_PARTIALS.map(() => cents((job.rng() - 0.5) * 2));
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    let v = 0;
    for (let k = 0; k < BELL_PARTIALS.length; k++) {
      const [ratio, amp, life] = BELL_PARTIALS[k];
      const f = job.freq * ratio * detune[k];
      if (f > rate * 0.45) continue;
      v += Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-t / (life * 0.4 * stretch));
    }
    v += strike.process(job.rng() * 2 - 1) * 0.35 * Math.exp(-t / 3e-3);
    target[at2] += v * 0.28 * (0.35 + 0.65 * job.velocity);
  }
}
function karplus(target, offset, job, options) {
  const rate = job.sampleRate;
  const period = rate / job.freq;
  const length = Math.max(2, Math.floor(period - 0.5));
  const frac = period - 0.5 - length;
  const allpass = (1 - frac) / (1 + frac);
  const line = new Float32Array(length);
  const pick = Math.max(1, Math.round(period * options.pickPosition));
  const tone = 0.25 + 0.7 * options.bright * (0.4 + 0.6 * job.velocity);
  const soft = new Float32Array(length);
  let lp = 0;
  for (let i = 0; i < length; i++) {
    lp += tone * (job.rng() * 2 - 1 - lp);
    soft[i] = 0.75 * (1 - 2 * i / length) + 0.35 * lp;
  }
  for (let i = 0; i < length; i++) line[i] = soft[i] - (i >= pick ? soft[i - pick] * 0.5 : 0);
  const rho = 10 ** (-3 / (options.t60 * job.freq));
  const n = Math.round(Math.min(options.t60 * 1.1, 4) * rate);
  const heldSamples = job.samples;
  let index = 0;
  let prev = 0;
  let apX = 0;
  let apY = 0;
  const body = new Biquad("lowpass", Math.min(7e3, rate * 0.4), rate);
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 >= target.length) break;
    const cur = line[index];
    const avg = 0.5 * (cur + prev);
    const out = allpass * (avg - apY) + apX;
    apX = avg;
    apY = out;
    prev = cur;
    line[index] = out * rho;
    index = (index + 1) % length;
    let gain = 1;
    if (i > heldSamples) gain = Math.max(0, 1 - (i - heldSamples) / (rate * options.muteRelease));
    if (gain <= 0) break;
    if (at2 >= 0) target[at2] += body.process(cur) * gain * 0.7 * (0.35 + 0.65 * job.velocity);
  }
}
function pluck(target, offset, job) {
  karplus(target, offset, job, { t60: 2, bright: 0.6, pickPosition: 0.18, muteRelease: 1.2 });
}
function harp(target, offset, job) {
  karplus(target, offset, job, { t60: 3.2, bright: 1, pickPosition: 0.3, muteRelease: 2.2 });
}
function marimba(target, offset, job) {
  const rate = job.sampleRate;
  const life = 0.5 * (1 - 0.6 * Math.min(1, job.freq / 2e3));
  const n = Math.round(rate * life * 6);
  const knock = new Biquad("bandpass", 1800, rate, 1.5);
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    const t = i / rate;
    const f = job.freq;
    let v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / life);
    v += 0.35 * Math.sin(2 * Math.PI * f * 3.9 * t) * Math.exp(-t / (life * 0.12));
    v += 0.1 * Math.sin(2 * Math.PI * f * 9.2 * t) * Math.exp(-t / (life * 0.05));
    v += knock.process(job.rng() * 2 - 1) * 0.3 * Math.exp(-t / 4e-3);
    target[at2] += v * 0.6 * (0.35 + 0.65 * job.velocity);
  }
}
function sampler(target, offset, job) {
  const s = job.sample;
  if (!s) return;
  const ratio = job.freq / midiToFreq(s.rootMidi) * (s.sampleRate / job.sampleRate);
  const rate = job.sampleRate;
  const release = 0.08;
  const loopStart = Math.floor(s.data.length * 0.4);
  const n = total(job, release);
  for (let i = 0; i < n; i++) {
    const at2 = offset + i;
    if (at2 < 0 || at2 >= target.length) continue;
    let pos = i * ratio;
    if (s.loop && pos >= s.data.length - 2) pos = loopStart + (pos - loopStart) % (s.data.length - 2 - loopStart);
    if (pos >= s.data.length - 2) break;
    const k = Math.floor(pos);
    const x = pos - k;
    const p0 = s.data[Math.max(0, k - 1)];
    const p1 = s.data[k];
    const p2 = s.data[k + 1];
    const p3 = s.data[Math.min(s.data.length - 1, k + 2)];
    const v = 0.5 * (2 * p1 + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x * x + (-p0 + 3 * p1 - 3 * p2 + p3) * x * x * x);
    const t = i / rate;
    const amp = adsr(t, job.samples / rate, 3e-3, 0, 1, release);
    target[at2] += v * amp * (0.35 + 0.65 * job.velocity);
  }
}
var RENDERERS = {
  lead,
  bass,
  pad,
  strings,
  brass,
  flute,
  organ,
  epiano,
  bell,
  pluck,
  harp,
  marimba,
  sampler
};
function renderNote(id, target, offset, job) {
  RENDERERS[id](target, offset, job);
}
function noteSamples(id, job) {
  const rate = job.sampleRate;
  switch (id) {
    case "lead":
      return total(job, 0.14);
    case "bass":
      return total(job, 0.08);
    case "pad":
      return total(job, 1.1);
    case "strings":
      return total(job, 0.45);
    case "brass":
      return total(job, 0.12);
    case "flute":
      return total(job, 0.15);
    case "organ":
      return total(job, 0.05);
    case "epiano":
      return total(job, 0.25) + Math.round(1.2 * rate);
    case "bell":
      return Math.round(rate * 4.5 * (1 + Math.min(2, job.samples / rate) * 0.5));
    case "pluck":
      return Math.round(Math.min(2 * 1.1, 4) * rate);
    case "harp":
      return Math.round(Math.min(3.2 * 1.1, 4) * rate);
    case "marimba": {
      const life = 0.5 * (1 - 0.6 * Math.min(1, job.freq / 2e3));
      return Math.round(rate * life * 6);
    }
    case "sampler":
      return total(job, 0.08);
  }
}
function isInstrument(id) {
  return id in INSTRUMENTS;
}
var METAL = [263, 400, 421, 474, 587, 845];
function renderStudioDrum(target, offset, drum, velocity, rate, rng) {
  const vel = 0.3 + 0.7 * velocity;
  const detune = 1 + (rng() - 0.5) * 0.03;
  const write = (length, fn) => {
    const n = Math.round(length * rate);
    for (let i = 0; i < n; i++) {
      const at2 = offset + i;
      if (at2 < 0 || at2 >= target.length) continue;
      target[at2] += fn(i / rate, i) * vel;
    }
  };
  const metal = (t, k = 1) => {
    let s = 0;
    for (const f of METAL) s += Math.sign(Math.sin(2 * Math.PI * f * k * detune * t));
    return s / METAL.length;
  };
  switch (drum) {
    case "kick": {
      let phase = 0;
      const click = new Biquad("highpass", 2500, rate);
      write(0.45, (t) => {
        const f = (45 + 105 * Math.exp(-t / 0.035)) * detune;
        phase += f / rate;
        const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.13);
        const tick = click.process(rng() * 2 - 1) * Math.exp(-t / 4e-3) * 0.35;
        return Math.tanh((body + tick) * 1.4) * 0.9;
      });
      break;
    }
    case "snare": {
      const noise = new Biquad("highpass", 1200, rate);
      const band = new Biquad("lowpass", 8e3, rate);
      let p1 = 0;
      let p2 = 0;
      write(0.4, (t) => {
        p1 += 190 * detune / rate;
        p2 += 330 * detune / rate;
        const tone = (Math.sin(2 * Math.PI * p1) * 0.7 + Math.sin(2 * Math.PI * p2) * 0.3) * Math.exp(-t / 0.07);
        const hiss = band.process(noise.process(rng() * 2 - 1)) * Math.exp(-t / 0.09);
        return tone * 0.55 + hiss * 0.7;
      });
      break;
    }
    case "hat":
    case "openhat": {
      const hp = new Biquad("highpass", 7e3, rate, 0.9);
      const life = drum === "hat" ? 0.03 : 0.28;
      write(life * 6, (t) => hp.process(metal(t) * 0.6 + (rng() * 2 - 1) * 0.5) * Math.exp(-t / life) * 0.55);
      break;
    }
    case "crash": {
      const hp = new Biquad("highpass", 4500, rate);
      write(2.4, (t) => hp.process(metal(t, 1.3) * 0.4 + (rng() * 2 - 1) * 0.7) * Math.exp(-t / 0.7) * 0.5);
      break;
    }
    case "ride": {
      const hp = new Biquad("highpass", 6e3, rate);
      write(1.6, (t) => {
        const ping = Math.sin(2 * Math.PI * 3400 * detune * t) * Math.exp(-t / 0.18) * 0.25;
        return hp.process(metal(t, 0.9) * 0.5 + (rng() * 2 - 1) * 0.25) * Math.exp(-t / 0.45) * 0.4 + ping;
      });
      break;
    }
    case "clap": {
      const band = new Biquad("bandpass", 1800, rate, 1.2);
      const bursts = [0, 0.011, 0.022, 0.033];
      write(0.3, (t) => {
        let env = Math.exp(-(t - 0.033) / 0.09) * (t > 0.033 ? 1 : 0);
        for (const b of bursts) if (t >= b && t < b + 8e-3) env = Math.max(env, 1 - (t - b) / 8e-3);
        return band.process(rng() * 2 - 1) * env * 1.4;
      });
      break;
    }
    case "tom": {
      let phase = 0;
      write(0.5, (t) => {
        const f = (75 + 45 * Math.exp(-t / 0.06)) * detune;
        phase += f / rate;
        return (Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.18) + (rng() * 2 - 1) * Math.exp(-t / 0.01) * 0.15) * 0.9;
      });
      break;
    }
  }
}
var STUDIO_DRUM_TAIL = {
  kick: 0.45,
  snare: 0.4,
  hat: 0.18,
  openhat: 1.7,
  crash: 2.4,
  clap: 0.3,
  tom: 0.5,
  ride: 1.6
};

// src/web/protocol.ts
var BUNDLE_VERSION = true ? "63671184 2026-10-23" : "dev";
var DEFAULT_SAMPLE_BASE_URL = "https://raw.githubusercontent.com/SweetCuteWitch/forge-audio/main/samples/";
function synthList() {
  return Object.entries(INSTRUMENTS).filter(([id]) => id !== "sampler").map(([id, i]) => ({ id, low: i.low, high: i.high, role: i.role, description: i.description }));
}
var buffer = (a) => a.buffer;
async function handle(session2, msg, post) {
  const { id } = msg;
  try {
    switch (msg.type) {
      case "update":
        session2.update(msg.tune);
        post({ id, type: "done", result: { dirty: session2.dirty() } });
        return;
      case "audible":
        session2.setAudible(msg.names);
        post({ id, type: "done", result: null });
        return;
      case "render": {
        const r = await session2.render((progress) => post({ id, type: "progress", progress }));
        post({ id, type: "done", result: r }, [buffer(r.left), buffer(r.right)]);
        return;
      }
      case "preview": {
        const r = await session2.preview(msg.channel, msg.cell);
        post({ id, type: "done", result: r }, [buffer(r.data)]);
        return;
      }
      case "synths":
        post({ id, type: "done", result: { version: BUNDLE_VERSION, synths: synthList() } });
        return;
      default:
        throw new Error(`unknown message type "${msg.type}"`);
    }
  } catch (e) {
    post({ id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

// src/sound/flac.ts
function crcTable(width, poly) {
  const table = new Uint16Array(256);
  const top = 1 << width - 1;
  const mask = (1 << width) - 1;
  for (let i = 0; i < 256; i++) {
    let c = i << width - 8;
    for (let b = 0; b < 8; b++) c = c & top ? (c << 1 ^ poly) & mask : c << 1 & mask;
    table[i] = c;
  }
  return table;
}
var CRC8 = crcTable(8, 7);
var CRC16 = crcTable(16, 32773);
function crc8(bytes, from, to) {
  let c = 0;
  for (let i = from; i < to; i++) c = CRC8[c ^ bytes[i]];
  return c;
}
function crc16(bytes, from, to) {
  let c = 0;
  for (let i = from; i < to; i++) c = c << 8 & 65535 ^ CRC16[c >> 8 ^ bytes[i]];
  return c;
}
var BitReader = class {
  constructor(bytes, startByte) {
    this.bytes = bytes;
    this.pos = startByte * 8;
  }
  bytes;
  /** Position in bits. */
  pos;
  get bytePos() {
    return Math.floor(this.pos / 8);
  }
  eof() {
    throw new ForgeFormatError("FLAC: the stream ends inside a frame");
  }
  /** An unsigned value of up to 53 bits. */
  bits(n) {
    let v = 0;
    while (n > 0) {
      const at2 = this.pos >>> 3;
      if (at2 >= this.bytes.length) this.eof();
      const avail = 8 - (this.pos & 7);
      const take = avail < n ? avail : n;
      v = v * (1 << take) + (this.bytes[at2] >> avail - take & (1 << take) - 1);
      n -= take;
      this.pos += take;
    }
    return v;
  }
  /** A two's-complement value of n bits. */
  signed(n) {
    if (n === 0) return 0;
    const v = this.bits(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }
  /** Counts zero bits up to and including the terminating one bit. */
  unary() {
    let count = 0;
    for (; ; ) {
      const at2 = this.pos >>> 3;
      if (at2 >= this.bytes.length) this.eof();
      const off = this.pos & 7;
      const b = this.bytes[at2] << off & 255;
      if (b === 0) {
        count += 8 - off;
        this.pos += 8 - off;
        continue;
      }
      const lead2 = Math.clz32(b) - 24;
      this.pos += lead2 + 1;
      return count + lead2;
    }
  }
  align() {
    this.pos = Math.ceil(this.pos / 8) * 8;
  }
};
var RATE_CODES = [0, 88200, 176400, 192e3, 8e3, 16e3, 22050, 24e3, 32e3, 44100, 48e3, 96e3];
var SIZE_CODES = [0, 8, 12, -1, 16, 20, 24, 32];
function decodeFlac(bytes) {
  let at2 = 0;
  if (bytes.length >= 10 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    at2 = 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
  }
  if (bytes.length < at2 + 8 || bytes[at2] !== 102 || bytes[at2 + 1] !== 76 || bytes[at2 + 2] !== 97 || bytes[at2 + 3] !== 67) {
    throw new ForgeFormatError('FLAC: not a FLAC stream (no "fLaC" marker)');
  }
  at2 += 4;
  let info = null;
  for (let last = false; !last; ) {
    if (at2 + 4 > bytes.length) throw new ForgeFormatError("FLAC: the metadata is cut short");
    last = (bytes[at2] & 128) !== 0;
    const type = bytes[at2] & 127;
    const length2 = bytes[at2 + 1] << 16 | bytes[at2 + 2] << 8 | bytes[at2 + 3];
    const body = at2 + 4;
    if (body + length2 > bytes.length) throw new ForgeFormatError("FLAC: a metadata block runs past the end");
    if (type === 0) {
      if (length2 < 34) throw new ForgeFormatError("FLAC: STREAMINFO is too short");
      const r = new BitReader(bytes, body + 10);
      const sampleRate = r.bits(20);
      const channels2 = r.bits(3) + 1;
      const bitsPerSample = r.bits(5) + 1;
      const totalSamples = r.bits(36);
      info = { sampleRate, channels: channels2, bitsPerSample, totalSamples };
    } else if (type === 127) {
      throw new ForgeFormatError("FLAC: invalid metadata block type 127");
    }
    if (info === null) throw new ForgeFormatError("FLAC: the first metadata block is not STREAMINFO");
    at2 = body + length2;
  }
  const stream = info;
  if (stream.bitsPerSample < 4) throw new ForgeFormatError(`FLAC: bit depth ${stream.bitsPerSample} is invalid`);
  const chunks = Array.from({ length: stream.channels }, () => []);
  let decoded = 0;
  while (at2 + 2 <= bytes.length && bytes[at2] === 255 && (bytes[at2 + 1] & 254) === 248) {
    if (stream.totalSamples > 0 && decoded >= stream.totalSamples) break;
    const { next, samples } = decodeFrame(bytes, at2, stream);
    for (let c = 0; c < stream.channels; c++) chunks[c].push(samples[c]);
    decoded += samples[0].length;
    at2 = next;
  }
  const length = stream.totalSamples > 0 ? Math.min(stream.totalSamples, decoded) : decoded;
  const scale = 1 / 2 ** (stream.bitsPerSample - 1);
  const channels = chunks.map((list) => {
    const out = new Float32Array(length);
    let o = 0;
    for (const chunk of list) {
      for (let i = 0; i < chunk.length && o < length; i++) out[o++] = chunk[i] * scale;
    }
    return out;
  });
  return { sampleRate: stream.sampleRate, bitsPerSample: stream.bitsPerSample, channels };
}
function decodeFrame(bytes, start, stream) {
  const r = new BitReader(bytes, start);
  r.bits(15);
  r.bits(1);
  const blockCode = r.bits(4);
  const rateCode = r.bits(4);
  const channelCode = r.bits(4);
  const sizeCode = r.bits(3);
  if (r.bits(1) !== 0) throw new ForgeFormatError("FLAC: a reserved frame header bit is set");
  readUtf8Number(r);
  let blockSize;
  if (blockCode === 0) throw new ForgeFormatError("FLAC: reserved block size code 0");
  else if (blockCode === 1) blockSize = 192;
  else if (blockCode <= 5) blockSize = 576 * 2 ** (blockCode - 2);
  else if (blockCode === 6) blockSize = r.bits(8) + 1;
  else if (blockCode === 7) blockSize = r.bits(16) + 1;
  else blockSize = 256 * 2 ** (blockCode - 8);
  if (rateCode === 12) r.bits(8);
  else if (rateCode === 13 || rateCode === 14) r.bits(16);
  else if (rateCode === 15) throw new ForgeFormatError("FLAC: invalid sample rate code 15");
  const headerEnd = r.bytePos;
  if (r.bits(8) !== crc8(bytes, start, headerEnd)) throw new ForgeFormatError("FLAC: frame header CRC-8 mismatch");
  let bps = stream.bitsPerSample;
  if (sizeCode !== 0) {
    bps = SIZE_CODES[sizeCode];
    if (bps < 0) throw new ForgeFormatError("FLAC: reserved sample size code 3");
  }
  let channels;
  if (channelCode < 8) channels = channelCode + 1;
  else if (channelCode <= 10) channels = 2;
  else throw new ForgeFormatError(`FLAC: reserved channel assignment ${channelCode}`);
  if (channels !== stream.channels) {
    throw new ForgeFormatError(`FLAC: a frame has ${channels} channels, STREAMINFO says ${stream.channels}`);
  }
  const samples = [];
  for (let c = 0; c < channels; c++) {
    const isSide = channelCode === 8 && c === 1 || channelCode === 9 && c === 0 || channelCode === 10 && c === 1;
    samples.push(decodeSubframe(r, blockSize, bps + (isSide ? 1 : 0)));
  }
  r.align();
  const frameEnd = r.bytePos;
  if (r.bits(16) !== crc16(bytes, start, frameEnd)) throw new ForgeFormatError("FLAC: frame CRC-16 mismatch");
  if (channelCode === 8) {
    const [left, side] = samples;
    for (let i = 0; i < blockSize; i++) side[i] = left[i] - side[i];
  } else if (channelCode === 9) {
    const [side, right] = samples;
    for (let i = 0; i < blockSize; i++) side[i] = side[i] + right[i];
  } else if (channelCode === 10) {
    const [mid, side] = samples;
    for (let i = 0; i < blockSize; i++) {
      const m = mid[i] * 2 + (side[i] & 1);
      mid[i] = Math.floor((m + side[i]) / 2);
      side[i] = Math.floor((m - side[i]) / 2);
    }
  }
  if (bps !== stream.bitsPerSample) {
    const k = 2 ** (stream.bitsPerSample - bps);
    for (const s of samples) for (let i = 0; i < blockSize; i++) s[i] *= k;
  }
  return { next: frameEnd + 2, samples };
}
function readUtf8Number(r) {
  const first = r.bits(8);
  if (first < 128) return first;
  let ones = 0;
  while (ones < 8 && first & 128 >> ones) ones++;
  if (ones === 1 || ones === 8) throw new ForgeFormatError("FLAC: a malformed frame number");
  let v = first & 127 >> ones;
  for (let i = 1; i < ones; i++) {
    const b = r.bits(8);
    if ((b & 192) !== 128) throw new ForgeFormatError("FLAC: a malformed frame number");
    v = v * 64 + (b & 63);
  }
  return v;
}
function decodeSubframe(r, n, bps) {
  if (r.bits(1) !== 0) throw new ForgeFormatError("FLAC: subframe padding bit is set");
  const type = r.bits(6);
  let wasted = 0;
  if (r.bits(1) === 1) wasted = r.unary() + 1;
  const bits = bps - wasted;
  if (bits <= 0) throw new ForgeFormatError("FLAC: more wasted bits than bits per sample");
  const out = new Float64Array(n);
  if (type === 0) {
    out.fill(r.signed(bits));
  } else if (type === 1) {
    for (let i = 0; i < n; i++) out[i] = r.signed(bits);
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    if (order > n) throw new ForgeFormatError("FLAC: predictor order exceeds the block size");
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    readResidual(r, n, order, out);
    restoreFixed(out, order);
  } else if (type >= 32) {
    const order = type - 31;
    if (order > n) throw new ForgeFormatError("FLAC: predictor order exceeds the block size");
    for (let i = 0; i < order; i++) out[i] = r.signed(bits);
    const precision = r.bits(4) + 1;
    if (precision === 16) throw new ForgeFormatError("FLAC: invalid LPC coefficient precision");
    const shift = r.signed(5);
    const coefs = [];
    for (let i = 0; i < order; i++) coefs.push(r.signed(precision));
    readResidual(r, n, order, out);
    const div = 2 ** shift;
    for (let i = order; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) sum += coefs[j] * out[i - 1 - j];
      out[i] += Math.floor(sum / div);
    }
  } else {
    throw new ForgeFormatError(`FLAC: reserved subframe type ${type}`);
  }
  if (wasted > 0) {
    const k = 2 ** wasted;
    for (let i = 0; i < n; i++) out[i] *= k;
  }
  return out;
}
function readResidual(r, n, order, out) {
  const method = r.bits(2);
  if (method > 1) throw new ForgeFormatError(`FLAC: reserved residual coding method ${method}`);
  const paramBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const partitionOrder = r.bits(4);
  const partitions = 2 ** partitionOrder;
  const per = n / partitions;
  if (!Number.isInteger(per) || per < order) {
    throw new ForgeFormatError("FLAC: the residual partition order does not fit the block");
  }
  let at2 = order;
  for (let p = 0; p < partitions; p++) {
    const end = (p + 1) * per;
    const k = r.bits(paramBits);
    if (k === escape) {
      const raw = r.bits(5);
      for (; at2 < end; at2++) out[at2] = r.signed(raw);
    } else {
      const pow = 2 ** k;
      for (; at2 < end; at2++) {
        const u = r.unary() * pow + r.bits(k);
        out[at2] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
      }
    }
  }
}
function restoreFixed(s, order) {
  const n = s.length;
  switch (order) {
    case 1:
      for (let i = 1; i < n; i++) s[i] += s[i - 1];
      break;
    case 2:
      for (let i = 2; i < n; i++) s[i] += 2 * s[i - 1] - s[i - 2];
      break;
    case 3:
      for (let i = 3; i < n; i++) s[i] += 3 * s[i - 1] - 3 * s[i - 2] + s[i - 3];
      break;
    case 4:
      for (let i = 4; i < n; i++) s[i] += 4 * s[i - 1] - 6 * s[i - 2] + 4 * s[i - 3] - s[i - 4];
      break;
  }
}
var RATE_INDEX = new Map(RATE_CODES.map((rate, code) => [rate, code]).filter(([, code]) => code > 0));

// src/sound/automation.ts
var CURVES = ["linear", "exp", "smooth"];
var hz = (needs) => ({ low: 20, high: 2e4, curve: "exp", unit: "Hz", ...needs ? { needs } : {} });
var unit = (needs, high = 1) => ({ low: 0, high, curve: "linear", unit: "", ...needs ? { needs } : {} });
var db = (low = -24, high = 24) => ({ low, high, curve: "linear", unit: "dB" });
var CHANNEL_PARAMS = {
  level: db(-60, 12),
  pan: { low: -1, high: 1, curve: "linear", unit: "" },
  reverb: unit(),
  chorus: unit(),
  "eq.hp": hz(),
  "eq.lp": hz(),
  "eq.low": db(),
  "eq.mid": db(),
  "eq.high": db(),
  "drive.amount": unit("drive"),
  "drive.tone": { ...hz("drive"), low: 200 },
  "drive.mix": unit("drive"),
  "filter.cutoff": hz("filter"),
  "filter.resonance": unit("filter"),
  "crush.bits": { low: 1, high: 16, curve: "linear", unit: "bits", needs: "crush" },
  "crush.rate": { low: 200, high: 48e3, curve: "exp", unit: "Hz", needs: "crush" },
  "crush.mix": unit("crush"),
  "phaser.mix": unit("phaser"),
  "phaser.depth": unit("phaser"),
  "flanger.mix": unit("flanger"),
  "flanger.depth": unit("flanger"),
  "tremolo.depth": unit("tremolo"),
  "autopan.depth": unit("autopan"),
  "slicer.depth": unit("slicer"),
  "delay.mix": unit("delay"),
  "delay.feedback": unit("delay", 0.95),
  "space.mix": unit("space"),
  width: unit(void 0, 2)
};
var MASTER_PARAMS = {
  level: db(-60, 12),
  "eq.hp": hz(),
  "eq.lp": hz(),
  "eq.low": db(),
  "eq.mid": db(),
  "eq.high": db(),
  "reverb.wet": unit("reverb"),
  width: unit(void 0, 2)
};
function laneOf(spec, info) {
  return Array.isArray(spec) ? { points: spec, curve: info.curve } : { points: spec.points, curve: spec.curve ?? info.curve };
}
function checkAutomation(value, table, where, present) {
  if (value === void 0) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ForgeFormatError(`${where}: automation must be an object of parameter \u2192 [[bar, value], \u2026]`);
  }
  for (const [name, spec] of Object.entries(value)) {
    const info = table[name];
    if (!info) throw new ForgeFormatError(`${where}: automation of unknown parameter "${name}"; it takes ${Object.keys(table).join(", ")}`);
    if (info.needs && !present(info.needs)) {
      throw new ForgeFormatError(`${where}: automation of ${name} needs fx.${info.needs} on the same ${where.startsWith("master") ? "master" : "channel"}`);
    }
    const raw = spec;
    const points = Array.isArray(spec) ? spec : raw?.points;
    if (!Array.isArray(spec)) {
      if (!spec || typeof spec !== "object") throw new ForgeFormatError(`${where}: automation.${name} must be [[bar, value], \u2026] or { points, curve }`);
      if (raw.curve !== void 0 && !CURVES.includes(raw.curve)) {
        throw new ForgeFormatError(`${where}: automation.${name}.curve must be one of ${CURVES.join(", ")}, got ${String(raw.curve)}`);
      }
    }
    if (!Array.isArray(points) || points.length === 0) throw new ForgeFormatError(`${where}: automation.${name} needs at least one [bar, value] point`);
    let last = -Infinity;
    for (const p of points) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new ForgeFormatError(`${where}: automation.${name}: a point is [bar, value], got ${JSON.stringify(p)}`);
      }
      const [bar, v] = p;
      if (bar < 0) throw new ForgeFormatError(`${where}: automation.${name}: bar ${bar} is before the start`);
      if (bar <= last) throw new ForgeFormatError(`${where}: automation.${name}: bars must rise, ${bar} comes after ${last}`);
      if (v < info.low || v > info.high) {
        throw new ForgeFormatError(`${where}: automation.${name}: ${v} is outside ${info.low} \u2026 ${info.high}${info.unit ? ` ${info.unit}` : ""}`);
      }
      last = bar;
    }
  }
}
function laneValue(points, curve, bar) {
  if (bar <= points[0][0]) return points[0][1];
  const lastPoint = points[points.length - 1];
  if (bar >= lastPoint[0]) return lastPoint[1];
  let k = 1;
  while (points[k][0] < bar) k++;
  const [b0, v0] = points[k - 1];
  const [b1, v1] = points[k];
  let u = (bar - b0) / (b1 - b0);
  if (curve === "smooth") u = u * u * (3 - 2 * u);
  if (curve === "exp" && v0 > 0 && v1 > 0) return v0 * (v1 / v0) ** u;
  return v0 + (v1 - v0) * u;
}
function laneCurve(points, curve, t) {
  const out = new Float32Array(t.length);
  const loopSamples = t.loopSeconds * t.rate;
  const barSamples = t.barSeconds * t.rate;
  for (let i = 0; i < t.length; i++) {
    const pass = Math.min(t.passes - 1, Math.floor(i / loopSamples));
    out[i] = laneValue(points, curve, (i - pass * loopSamples) / barSamples);
  }
  return out;
}
var Lanes = class {
  constructor(automation, table, timeline) {
    this.automation = automation;
    this.table = table;
    this.timeline = timeline;
  }
  automation;
  table;
  timeline;
  cache = /* @__PURE__ */ new Map();
  /** Whether a parameter is automated. */
  has(name) {
    return this.automation?.[name] !== void 0;
  }
  /** The per-sample curve of a parameter, or undefined when it does not move. */
  curve(name) {
    const spec = this.automation?.[name];
    if (spec === void 0) return void 0;
    let c = this.cache.get(name);
    if (!c) {
      const { points, curve } = laneOf(spec, this.table[name]);
      c = laneCurve(points, curve, this.timeline);
      this.cache.set(name, c);
    }
    return c;
  }
  /** The parameter as a `Param`: its curve when automated, else the fixed value. */
  param(name, fixed) {
    return this.curve(name) ?? fixed;
  }
};
function noteSeconds(text, tempo) {
  const s = text.trim();
  const ms = /^(\d+(?:\.\d+)?)\s*ms$/i.exec(s);
  if (ms) return Number(ms[1]) / 1e3;
  const m = /^(\d+)\s*\/\s*(\d+)\s*([dt]?)$/i.exec(s);
  if (!m || Number(m[1]) === 0 || Number(m[2]) === 0) {
    throw new ForgeFormatError(`Cannot read the time "${text}": write 1/8, 3/16, 1/8d (dotted), 1/8t (triplet), 2/1 or 300ms`);
  }
  const mod = m[3].toLowerCase() === "d" ? 1.5 : m[3].toLowerCase() === "t" ? 2 / 3 : 1;
  return 60 / tempo * 4 * (Number(m[1]) / Number(m[2])) * mod;
}
function isNoteTime(text) {
  if (typeof text !== "string") return false;
  try {
    noteSeconds(text, 120);
    return true;
  } catch {
    return false;
  }
}
function rateHz(rate, tempo) {
  return typeof rate === "number" ? rate : 1 / noteSeconds(rate, tempo);
}
function isRate(rate) {
  if (typeof rate === "number") return Number.isFinite(rate) && rate >= 0.01 && rate <= 40;
  return isNoteTime(rate);
}
var LFO_SHAPES = ["sine", "triangle", "saw", "ramp", "square", "random"];
var LFO_EDGE_S = 3e-3;
function lfo(length, sampleRate, hz2, shape = "sine", phase = 0, seed = 1) {
  const out = new Float32Array(length);
  const rng = createRng(seed);
  let held = rng() * 2 - 1;
  let cycle = 0;
  for (let i = 0; i < length; i++) {
    const p = hz2 * (i / sampleRate) + phase;
    const c = Math.floor(p);
    const f = p - c;
    switch (shape) {
      case "sine":
        out[i] = Math.sin(2 * Math.PI * f);
        break;
      case "triangle":
        out[i] = f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4;
        break;
      case "saw":
        out[i] = 1 - 2 * f;
        break;
      case "ramp":
        out[i] = 2 * f - 1;
        break;
      case "square":
        out[i] = f < 0.5 ? 1 : -1;
        break;
      case "random":
        while (cycle < c) {
          held = rng() * 2 - 1;
          cycle++;
        }
        out[i] = held;
        break;
    }
  }
  if (shape === "square" || shape === "random") {
    const k = 1 - Math.exp(-1 / (LFO_EDGE_S * sampleRate));
    let y = out[0];
    for (let i = 0; i < length; i++) {
      y += (out[i] - y) * k;
      out[i] = y;
    }
  }
  return out;
}

// src/sound/fx.ts
var SVF_TYPES = ["lowpass", "highpass", "bandpass", "notch"];
var resonanceQ = (resonance) => 0.7071 * 2 ** (5 * Math.min(1, Math.max(0, resonance)));
function svf(buffer2, sampleRate, options) {
  const { type, cutoff, resonance, octaves } = options;
  const stages = options.slope === 24 ? 2 : 1;
  const top = sampleRate * 0.48;
  const s1 = new Float64Array(stages);
  const s2 = new Float64Array(stages);
  const fixedK = typeof resonance === "number" ? 1 / resonanceQ(resonance) : 0;
  for (let i = 0; i < buffer2.length; i++) {
    let fc = at(cutoff, i);
    if (octaves) fc *= 2 ** octaves[i];
    fc = Math.min(top, Math.max(16, fc));
    const g = Math.tan(Math.PI * fc / sampleRate);
    let x = buffer2[i];
    for (let s = 0; s < stages; s++) {
      const k = s === 0 ? typeof resonance === "number" ? fixedK : 1 / resonanceQ(at(resonance, i)) : Math.SQRT2;
      const a1 = 1 / (1 + g * (g + k));
      const a2 = g * a1;
      const a3 = g * a2;
      const v3 = x - s2[s];
      const v1 = a1 * s1[s] + a2 * v3;
      const v2 = s2[s] + a2 * s1[s] + a3 * v3;
      s1[s] = 2 * v1 - s1[s];
      s2[s] = 2 * v2 - s2[s];
      switch (type) {
        case "lowpass":
          x = v2;
          break;
        case "highpass":
          x = x - k * v1 - v2;
          break;
        case "bandpass":
          x = k * v1;
          break;
        case "notch":
          x = x - k * v1;
          break;
      }
    }
    buffer2[i] = x;
  }
}
function triggerEnvelope(length, sampleRate, triggers, attackMs, decayMs) {
  const out = new Float32Array(length);
  const A = Math.max(1, Math.round(attackMs / 1e3 * sampleRate));
  const fall = Math.exp(-3 / Math.max(1, decayMs / 1e3 * sampleRate));
  let level = 0;
  let next = 0;
  let from = 0;
  let peak = 0;
  let rising = -1;
  const sorted = [...triggers].sort((a, b) => a.at - b.at);
  for (let i = 0; i < length; i++) {
    while (next < sorted.length && sorted[next].at <= i) {
      from = level;
      peak = sorted[next].strength;
      rising = 0;
      next++;
    }
    if (rising >= 0) {
      rising++;
      level = from + (peak - from) * Math.min(1, rising / A);
      if (rising >= A) rising = -1;
    } else level *= fall;
    out[i] = level;
  }
  return out;
}
function phaser(input, sampleRate, o) {
  const n = input.length;
  const out = new Float32Array(n);
  const x1 = new Float64Array(o.stages);
  const y1 = new Float64Array(o.stages);
  const ratio = o.high / o.low;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const u = 0.5 + 0.5 * at(o.depth, i) * o.wave[i];
    const f = Math.min(sampleRate * 0.45, o.low * ratio ** u);
    const t = Math.tan(Math.PI * f / sampleRate);
    const a = (t - 1) / (t + 1);
    let v = input[i] + o.feedback * last;
    for (let s = 0; s < o.stages; s++) {
      const y = a * v + x1[s] - a * y1[s];
      x1[s] = v;
      y1[s] = y;
      v = y;
    }
    last = v;
    const m = at(o.mix, i);
    out[i] = (input[i] + m * v) / (1 + m);
  }
  return out;
}
var FLANGER_SWEEP_MS = 6;
function flanger(input, sampleRate, o) {
  const n = input.length;
  const out = new Float32Array(n);
  const ms = sampleRate / 1e3;
  const size = Math.ceil((o.delayMs + FLANGER_SWEEP_MS) * ms) + 4;
  const line = new Float64Array(size);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const d = (o.delayMs + FLANGER_SWEEP_MS * at(o.depth, i) * 0.5 * (1 + o.wave[i])) * ms;
    const pos = w - Math.max(1, d);
    const k = Math.floor(pos);
    const frac = pos - k;
    const a = line[(k % size + size) % size];
    const b = line[((k + 1) % size + size) % size];
    const wet = a + (b - a) * frac;
    line[w % size] = input[i] + o.feedback * wet;
    w++;
    const m = at(o.mix, i);
    out[i] = (input[i] + m * wet) / (1 + m);
  }
  return out;
}
var EQ_BAND_TYPES = ["peak", "lowshelf", "highshelf", "notch", "lowpass", "highpass", "bandpass"];
var BUTTERWORTH_Q = {
  12: [0.7071],
  24: [0.5412, 1.3066],
  48: [0.5098, 0.6013, 0.9, 2.5629]
};
function slopedPass(buffer2, type, freq, sampleRate, slope = 12) {
  for (const q of BUTTERWORTH_Q[slope]) filterParamInPlace(buffer2, type, freq, sampleRate, q);
}
function eqBands(buffer2, bands, sampleRate) {
  for (const b of bands) {
    const q = b.q ?? (b.type === "peak" ? 1 : 0.7071);
    const f = new Biquad(b.type, b.freq, sampleRate, q, b.gain ?? 0);
    for (let i = 0; i < buffer2.length; i++) buffer2[i] = f.process(buffer2[i]);
  }
}
function widthInPlace(left, right, width) {
  for (let i = 0; i < left.length; i++) {
    const m = (left[i] + right[i]) * 0.5;
    const s = (left[i] - right[i]) * 0.5 * at(width, i);
    left[i] = m + s;
    right[i] = m - s;
  }
}
function haas(left, right, ms, sampleRate) {
  const d = Math.round(Math.abs(ms) / 1e3 * sampleRate);
  const late = (x) => {
    const out = new Float32Array(x.length);
    out.set(x.subarray(0, Math.max(0, x.length - d)), d);
    return out;
  };
  return ms >= 0 ? [left.slice(), late(right)] : [late(left), right.slice()];
}
function monoBelow(left, right, freq, sampleRate) {
  const n = left.length;
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) side[i] = (left[i] - right[i]) * 0.5;
  slopedPass(side, "highpass", freq, sampleRate, 12);
  slopedPass(side, "highpass", freq, sampleRate, 12);
  for (let i = 0; i < n; i++) {
    const m = (left[i] + right[i]) * 0.5;
    left[i] = m + side[i];
    right[i] = m - side[i];
  }
}
function crush(input, sampleRate, o) {
  const out = new Float32Array(input.length);
  let acc = 1;
  let held = 0;
  for (let i = 0; i < input.length; i++) {
    if (o.rate === void 0) held = input[i];
    else {
      acc += Math.min(1, at(o.rate, i) / sampleRate);
      if (acc >= 1) {
        acc -= 1;
        held = input[i];
      }
    }
    let y = held;
    if (o.bits !== void 0) {
      const step = 2 / 2 ** Math.max(1, at(o.bits, i));
      y = Math.round(y / step) * step;
    }
    const m = at(o.mix, i);
    out[i] = input[i] * (1 - m) + y * m;
  }
  return out;
}
var WOW_MS = 3;
var WOW_HZ = 0.55;
var FLUTTER_MS = 0.25;
var FLUTTER_HZ = 6.5;
function wowFlutter(input, sampleRate, wow, flutter, drift, jitter) {
  const out = new Float32Array(input.length);
  const ms = sampleRate / 1e3;
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const offset = (wow * WOW_MS * (0.7 * Math.sin(2 * Math.PI * WOW_HZ * t) + 0.3 * drift[i]) + flutter * FLUTTER_MS * (0.7 * Math.sin(2 * Math.PI * FLUTTER_HZ * t) + 0.3 * jitter[i])) * ms;
    const pos = Math.min(n - 1, Math.max(0, i - offset));
    const k = Math.floor(pos);
    const f = pos - k;
    out[i] = input[k] + ((input[Math.min(n - 1, k + 1)] ?? 0) - input[k]) * f;
  }
  return out;
}
var GATE_HYSTERESIS_DB = 4;
function gate(buffer2, sampleRate, o) {
  const n = buffer2.length;
  const ms = sampleRate / 1e3;
  const A = Math.max(1, Math.round(o.attack * ms));
  const H = Math.round(o.hold * ms);
  const R = Math.max(1, Math.round(o.release * ms));
  const fall = Math.exp(-1 / (10 * ms));
  const open = 10 ** (o.threshold / 20);
  const close = 10 ** ((o.threshold - GATE_HYSTERESIS_DB) / 20);
  const floor = Math.min(0, o.range);
  const env = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n + A; i++) {
    const x = i < n ? Math.abs(buffer2[i]) : 0;
    e = Math.max(x, e * fall);
    if (i - A >= 0) env[i - A] = e;
  }
  let isOpen = false;
  let under = 0;
  let g = floor;
  for (let i = 0; i < n; i++) {
    if (env[i] >= open) {
      isOpen = true;
      under = 0;
    } else if (isOpen && env[i] < close && ++under > H) isOpen = false;
    const target = isOpen ? 0 : floor;
    if (g < target) g = Math.min(target, g + -floor / A);
    else if (g > target) g = Math.max(target, g - -floor / R);
    buffer2[i] *= g <= -80 ? 0 : 10 ** (g / 20);
  }
}
function slicerGain(length, sampleRate, pattern, stepSeconds2, o) {
  const out = new Float32Array(length);
  const stepN = stepSeconds2 * sampleRate;
  const gapN = o.gapMs / 1e3 * sampleRate;
  const up = 1 / Math.max(1, o.attack / 1e3 * sampleRate);
  const down = 1 / Math.max(1, o.release / 1e3 * sampleRate);
  const p = pattern.length;
  let g = 0;
  for (let i = 0; i < length; i++) {
    const step = Math.floor(i / stepN);
    const ch = pattern[step % p];
    const next = pattern[(step + 1) % p];
    const intoStep = i - step * stepN;
    let target = ch === "." ? 0 : 1;
    if (target === 1 && next === "x" && intoStep >= stepN - gapN) target = 0;
    g = g < target ? Math.min(target, g + up) : Math.max(target, g - down);
    out[i] = g;
  }
  return out;
}
function transient(buffer2, sampleRate, o) {
  const ms = sampleRate / 1e3;
  const coef = (t) => Math.exp(-1 / (t * ms));
  const fastA = coef(0.5);
  const slowA = coef(25);
  const rel = coef(20);
  const slowR = coef(400);
  let fast = 0;
  let slow = 0;
  let tail = 0;
  let g = 0;
  const smooth = coef(1);
  const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-6));
  for (let i = 0; i < buffer2.length; i++) {
    const x = Math.abs(buffer2[i]);
    fast = x > fast ? fastA * fast + (1 - fastA) * x : rel * fast + (1 - rel) * x;
    slow = x > slow ? slowA * slow + (1 - slowA) * x : rel * slow + (1 - rel) * x;
    tail = x > tail ? fastA * tail + (1 - fastA) * x : slowR * tail + (1 - slowR) * x;
    const onset = Math.min(1, Math.max(0, (toDb(fast) - toDb(slow)) / 12));
    const decay = Math.min(1, Math.max(0, (toDb(tail) - toDb(fast)) / 12));
    const target = o.attack * onset + o.sustain * decay;
    g = smooth * g + (1 - smooth) * target;
    buffer2[i] *= 10 ** (g / 20);
  }
}
var EchoLine = class {
  constructor(delay, rate, loop) {
    this.delay = delay;
    this.rate = rate;
    this.loop = loop;
    this.line = new DelayLine(delay * 1.02 + 8);
    this.lp = new Biquad("lowpass", loop.tone, rate);
    this.hp = loop.low ? new Biquad("highpass", loop.low, rate) : null;
    this.k = 1 + 6 * (loop.drive ?? 0);
  }
  delay;
  rate;
  loop;
  line;
  lp;
  hp;
  k;
  /** The repeat at sample `i` (read before the write). */
  read(i) {
    const w = this.loop.wobble ?? 0;
    if (w === 0) return this.line.read(this.delay);
    const t = i / this.rate;
    const mod = w * 4e-3 * (0.7 * Math.sin(2 * Math.PI * 0.7 * t) + 0.3 * Math.sin(2 * Math.PI * 2.3 * t + 1));
    return this.line.read(this.delay * (1 + mod));
  }
  /** The loop's processing of a repeat, before the feedback gain. */
  shape(wet) {
    let y = this.lp.process(wet);
    if (this.hp) y = this.hp.process(y);
    if (this.k > 1) y = Math.tanh(y * this.k) / this.k;
    return y;
  }
  push(x) {
    this.line.push(x);
  }
};
function echoes(inL, inR, sampleRate, o) {
  const n = inL.length;
  const wetL = new Float32Array(n);
  const wetR = new Float32Array(n);
  const a = new EchoLine(o.delayL, sampleRate, o);
  const b = new EchoLine(o.mode === "stereo" ? o.delayR : o.delayL, sampleRate, o);
  for (let i = 0; i < n; i++) {
    const f = Math.min(0.95, Math.max(0, at(o.feedback, i)));
    const mono = (inL[i] + inR[i]) * 0.5;
    const ya = a.read(i);
    if (o.mode === "mono") {
      wetL[i] = ya;
      wetR[i] = ya;
      a.push(mono + a.shape(ya) * f);
      continue;
    }
    const yb = b.read(i);
    wetL[i] = ya;
    wetR[i] = yb;
    if (o.mode === "stereo") {
      a.push(inL[i] + a.shape(ya) * f);
      b.push(inR[i] + b.shape(yb) * f);
    } else {
      a.push(mono + b.shape(yb) * f);
      b.push(a.shape(ya) * f);
    }
  }
  if (o.duck) duckUnder(wetL, wetR, inL, inR, sampleRate, o.duck);
  return [wetL, wetR];
}
function duckUnder(wetL, wetR, dryL, dryR, sampleRate, amount) {
  const n = wetL.length;
  const att = Math.exp(-1 / (5e-3 * sampleRate));
  const rel = Math.exp(-1 / (0.12 * sampleRate));
  const env = new Float32Array(n);
  let e = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(dryL[i]), Math.abs(dryR[i]));
    e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x;
    env[i] = e;
    peak = Math.max(peak, e);
  }
  if (peak <= 0) return;
  for (let i = 0; i < n; i++) {
    const g = 1 - amount * Math.min(1, env[i] / (0.25 * peak));
    wetL[i] *= g;
    wetR[i] *= g;
  }
}
var SPACE_TYPES = ["room", "hall", "plate", "spring"];
var SPACE_DEFAULTS = {
  room: { size: 0.4, damp: 0.45, preDelay: 3 },
  hall: { size: 0.7, damp: 0.5, preDelay: 22 },
  plate: { size: 0.6, damp: 0.15, preDelay: 0 },
  spring: { size: 0.5, damp: 0.3, preDelay: 0 }
};
var SPACE_SHAPE = {
  room: { scale: 0.45, fb0: 0.68, fbSize: 0.2, diffuse: false, early: [[4.3, 0.55], [7.9, 0.42], [11.6, 0.33], [17.2, 0.25], [23.9, 0.18]] },
  hall: { scale: 1.15, fb0: 0.8, fbSize: 0.17, diffuse: false, early: [[13.1, 0.22], [21.7, 0.16], [33.4, 0.11]] },
  plate: { scale: 0.85, fb0: 0.78, fbSize: 0.19, diffuse: true, early: [] }
};
var SPACE_COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
var SPACE_ALLPASSES = [556, 441, 341, 225];
var PLATE_DIFFUSERS = [[142, 0.75], [107, 0.75], [379, 0.625], [277, 0.625]];
function space(inL, inR, sampleRate, o) {
  const n = inL.length;
  const pre = Math.round(o.preDelayMs / 1e3 * sampleRate);
  const mono = new Float32Array(n);
  for (let i = pre; i < n; i++) mono[i] = (inL[i - pre] + inR[i - pre]) * 0.5;
  const scaleRate = sampleRate / 44100;
  let left;
  let right;
  if (o.type === "spring") {
    left = spring(mono, sampleRate, o, 0);
    right = spring(mono, sampleRate, o, 1);
  } else {
    const shape = SPACE_SHAPE[o.type];
    let input = mono;
    if (shape.diffuse) {
      input = mono.slice();
      for (const [len, g] of PLATE_DIFFUSERS) {
        const buf = new Float64Array(Math.round(len * scaleRate));
        let k = 0;
        for (let i = 0; i < n; i++) {
          const d = buf[k];
          const v = input[i] - g * d;
          buf[k] = v;
          input[i] = d + g * v;
          k = (k + 1) % buf.length;
        }
      }
    }
    const feedback = Math.min(0.985, shape.fb0 + shape.fbSize * o.size);
    const damping = o.damp * 0.4;
    const side = (spread) => {
      const out = new Float32Array(n);
      const combs = SPACE_COMBS.map((t) => ({ buffer: new Float64Array(Math.max(8, Math.round((t + spread) * shape.scale * scaleRate))), index: 0, store: 0 }));
      const aps = SPACE_ALLPASSES.map((t) => ({ buffer: new Float64Array(Math.max(4, Math.round((t + spread) * scaleRate))), index: 0 }));
      for (let i = 0; i < n; i++) {
        const x = input[i] * 0.015;
        let sum = 0;
        for (const c of combs) {
          const y = c.buffer[c.index];
          c.store = y * (1 - damping) + c.store * damping;
          c.buffer[c.index] = x + c.store * feedback;
          c.index = (c.index + 1) % c.buffer.length;
          sum += y;
        }
        for (const ap of aps) {
          const b = ap.buffer[ap.index];
          const y = -sum + b;
          ap.buffer[ap.index] = sum + b * 0.5;
          ap.index = (ap.index + 1) % ap.buffer.length;
          sum = y;
        }
        out[i] = sum * 3;
      }
      for (const [ms, g] of shape.early) {
        const d = Math.round(ms * (spread ? 1.13 : 1) / 1e3 * sampleRate);
        for (let i = d; i < n; i++) out[i] += mono[i - d] * g;
      }
      return out;
    };
    left = side(0);
    right = side(23);
  }
  for (let i = 0; i < n; i++) {
    const m = (left[i] + right[i]) * 0.5;
    const s = (left[i] - right[i]) * 0.5 * o.width;
    left[i] = m + s;
    right[i] = m - s;
  }
  return [left, right];
}
function spring(input, sampleRate, o, sideIndex) {
  const n = input.length;
  const out = new Float32Array(n);
  const lengthsMs = sideIndex === 0 ? [31.3, 43.7] : [35.9, 39.1];
  const feedback = 0.55 + 0.4 * o.size;
  for (const ms of lengthsMs) {
    const d = ms / 1e3 * sampleRate;
    const line = new DelayLine(d + 4);
    const chain = new Float64Array(16 * 2);
    const a = -0.62;
    const lp = new Biquad("lowpass", 5e3 - 2500 * o.damp, sampleRate);
    const hp = new Biquad("highpass", 150, sampleRate);
    for (let i = 0; i < n; i++) {
      let v = line.read(d);
      for (let s = 0; s < 16; s++) {
        const x1 = chain[2 * s];
        const y1 = chain[2 * s + 1];
        const y = a * v + x1 - a * y1;
        chain[2 * s] = v;
        chain[2 * s + 1] = y;
        v = y;
      }
      v = hp.process(lp.process(v));
      out[i] += v * 0.5;
      line.push(input[i] + v * feedback);
    }
  }
  return out;
}
function onsetGate(dryL, dryR, sampleRate, ms) {
  const n = dryL.length;
  const att = Math.exp(-1 / (1e-3 * sampleRate));
  const rel = Math.exp(-1 / (0.05 * sampleRate));
  const env = new Float32Array(n);
  let e = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.max(Math.abs(dryL[i]), Math.abs(dryR[i]));
    e = x > e ? att * e + (1 - att) * x : rel * e + (1 - rel) * x;
    env[i] = e;
    peak = Math.max(peak, e);
  }
  const thr = peak * 10 ** (-24 / 20);
  const holdN = Math.round(ms / 1e3 * sampleRate);
  const fadeN = Math.max(1, Math.round(8e-3 * sampleRate));
  const g = new Float32Array(n);
  let last = -Infinity;
  let above = false;
  for (let i = 0; i < n; i++) {
    if (env[i] > thr && !above) last = i;
    above = env[i] > thr;
    const since = i - last;
    g[i] = since < holdN ? 1 : since < holdN + fadeN ? 1 - (since - holdN) / fadeN : 0;
  }
  return g;
}

// src/sound/fx-schema.ts
var Fields = class _Fields {
  constructor(obj2, where) {
    this.obj = obj2;
    this.where = where;
  }
  obj;
  where;
  fail(key, what, got) {
    throw new ForgeFormatError(`${this.where}.${key} must be ${what}, got ${JSON.stringify(got)}`);
  }
  /** A number in a range; `required` when it may not be left out. */
  num(key, low, high, required = false, unit2 = "") {
    const v = this.obj[key];
    if (v === void 0 && !required) return;
    if (typeof v !== "number" || !Number.isFinite(v) || v < low || v > high) this.fail(key, `${low} \u2026 ${high}${unit2 ? ` ${unit2}` : ""}`, v);
  }
  /** One of a set of values. */
  oneOf(key, values, required = false) {
    const v = this.obj[key];
    if (v === void 0 && !required) return;
    if (!values.includes(v)) this.fail(key, `one of ${values.join(", ")}`, v);
  }
  /** An LFO rate: Hz or a note length. */
  rate(key, required = false) {
    const v = this.obj[key];
    if (v === void 0 && !required) return;
    if (!isRate(v)) this.fail(key, 'a rate in Hz (0.01 \u2026 40) or a note length such as "1/8", "1/4d", "2/1"', v);
  }
  /** A nested object, checked by `inner`. */
  sub(key, inner) {
    const v = this.obj[key];
    if (v === void 0) return;
    if (!v || typeof v !== "object" || Array.isArray(v)) this.fail(key, "an object", v);
    inner(new _Fields(v, `${this.where}.${key}`));
  }
  /** Only these keys. */
  only(keys) {
    for (const k of Object.keys(this.obj)) {
      if (!keys.includes(k)) throw new ForgeFormatError(`${this.where}: unknown field "${k}"; it takes ${keys.join(", ")}`);
    }
  }
};
function effect(fx, name, where, check) {
  const v = fx[name];
  if (v === void 0) return;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ForgeFormatError(`${where}: fx.${name} must be an object`);
  check(new Fields(v, `${where}: fx.${name}`));
}
var lfoFields = (depthHigh) => (f) => {
  f.only(["rate", "depth", "shape", "phase"]);
  f.rate("rate", true);
  f.num("depth", 0, depthHigh, true);
  f.oneOf("shape", LFO_SHAPES);
  f.num("phase", 0, 1);
};
function checkEq(value, where) {
  if (value === void 0) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ForgeFormatError(`${where}.eq must be an object`);
  const f = new Fields(value, `${where}.eq`);
  f.only(["hp", "hpSlope", "lp", "lpSlope", "low", "mid", "high", "bands"]);
  f.num("hp", 0, 2e4, false, "Hz");
  f.num("lp", 0, 22e3, false, "Hz");
  f.oneOf("hpSlope", [12, 24, 48]);
  f.oneOf("lpSlope", [12, 24, 48]);
  for (const k of ["low", "mid", "high"]) f.num(k, -24, 24, false, "dB");
  const bands = value.bands;
  if (bands === void 0) return;
  if (!Array.isArray(bands) || bands.length > 8) throw new ForgeFormatError(`${where}.eq.bands must be a list of up to 8 bands`);
  bands.forEach((b, i) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new ForgeFormatError(`${where}.eq.bands[${i}] must be { type, freq, gain, q }`);
    const band = new Fields(b, `${where}.eq.bands[${i}]`);
    band.only(["type", "freq", "gain", "q"]);
    band.oneOf("type", EQ_BAND_TYPES, true);
    band.num("freq", 20, 2e4, true, "Hz");
    band.num("gain", -24, 24, false, "dB");
    band.num("q", 0.1, 20);
  });
}
function checkChannelFx(channel) {
  const where = `Channel ${channel.name}`;
  const fx = channel.fx ?? {};
  if (fx.eq !== void 0) checkEq(fx.eq, `${where}: fx`);
  const top = new Fields(fx, `${where}: fx`);
  top.num("width", 0, 2);
  top.num("haas", -40, 40, false, "ms");
  effect(fx, "filter", where, (f) => {
    f.only(["type", "cutoff", "resonance", "slope", "env", "lfo", "key"]);
    f.oneOf("type", SVF_TYPES);
    f.num("cutoff", 20, 2e4, true, "Hz");
    f.num("resonance", 0, 1);
    f.oneOf("slope", [12, 24]);
    f.sub("env", (e) => {
      e.only(["amount", "attack", "decay"]);
      e.num("amount", -8, 8, true, "octaves");
      e.num("attack", 0, 5e3, false, "ms");
      e.num("decay", 1, 1e4, false, "ms");
    });
    f.sub("lfo", lfoFields(8));
    f.num("key", 0, 1);
  });
  effect(fx, "phaser", where, (f) => {
    f.only(["rate", "depth", "feedback", "stages", "mix", "low", "high", "stereo", "shape"]);
    f.rate("rate");
    f.num("depth", 0, 1);
    f.num("feedback", 0, 0.9);
    f.oneOf("stages", [2, 4, 6, 8, 12]);
    f.num("mix", 0, 1);
    f.num("low", 20, 1e4, false, "Hz");
    f.num("high", 40, 2e4, false, "Hz");
    f.num("stereo", 0, 1);
    f.oneOf("shape", LFO_SHAPES);
    const p = fx.phaser;
    if ((p.low ?? 300) >= (p.high ?? 3500)) throw new ForgeFormatError(`${where}: fx.phaser.low must be below fx.phaser.high`);
  });
  effect(fx, "flanger", where, (f) => {
    f.only(["rate", "depth", "feedback", "mix", "delay", "stereo", "shape"]);
    f.rate("rate");
    f.num("depth", 0, 1);
    f.num("feedback", -0.95, 0.95);
    f.num("mix", 0, 1);
    f.num("delay", 0.2, 10, false, "ms");
    f.num("stereo", 0, 1);
    f.oneOf("shape", LFO_SHAPES);
  });
  effect(fx, "delay", where, (f) => {
    f.only(["time", "feedback", "mix", "mode", "timeR", "tone", "low", "drive", "wobble", "duck"]);
    const d = fx.delay;
    for (const k of ["time", "timeR"]) {
      if ((k === "time" || d[k] !== void 0) && !isNoteTime(d[k])) {
        throw new ForgeFormatError(`${where}: fx.delay.${k} must be a note length such as "1/8", "1/8d", "1/4t" or "300ms", got ${JSON.stringify(d[k])}`);
      }
    }
    f.num("feedback", 0, 0.95, true);
    f.num("mix", 0, 1, true);
    f.oneOf("mode", ["lean", "mono", "stereo", "pingpong"]);
    f.num("tone", 200, 2e4, false, "Hz");
    f.num("low", 20, 5e3, false, "Hz");
    for (const k of ["drive", "wobble", "duck"]) f.num(k, 0, 1);
  });
  effect(fx, "space", where, (f) => {
    f.only(["type", "mix", "size", "damp", "preDelay", "width", "gate"]);
    f.oneOf("type", SPACE_TYPES);
    for (const k of ["mix", "size", "damp", "width"]) f.num(k, 0, 1);
    f.num("preDelay", 0, 500, false, "ms");
    f.num("gate", 20, 2e3, false, "ms");
  });
  effect(fx, "comp", where, (f) => {
    f.only(["threshold", "ratio", "attack", "release", "knee", "makeup"]);
    f.num("threshold", -80, 0, true, "dBFS");
    f.num("ratio", 1, 100, true);
    f.num("attack", 0.05, 500, false, "ms");
    f.num("release", 1, 5e3, false, "ms");
    f.num("knee", 0, 24, false, "dB");
    f.num("makeup", -24, 24, false, "dB");
  });
  effect(fx, "gate", where, (f) => {
    f.only(["threshold", "range", "attack", "hold", "release"]);
    f.num("threshold", -80, 0, true, "dBFS");
    f.num("range", -80, 0, false, "dB");
    f.num("attack", 0, 100, false, "ms");
    f.num("hold", 0, 2e3, false, "ms");
    f.num("release", 1, 5e3, false, "ms");
  });
  effect(fx, "transient", where, (f) => {
    f.only(["attack", "sustain"]);
    f.num("attack", -24, 24, false, "dB");
    f.num("sustain", -24, 24, false, "dB");
  });
  effect(fx, "slicer", where, (f) => {
    f.only(["pattern", "step", "depth", "attack", "release", "gap"]);
    const p = fx.slicer.pattern;
    if (typeof p !== "string" || !/^[x.\-]{1,64}$/.test(p) || !p.includes("x")) {
      throw new ForgeFormatError(`${where}: fx.slicer.pattern must be 1 \u2026 64 of x (a slice), - (it goes on), . (shut), with at least one x; got ${JSON.stringify(p)}`);
    }
    const step = fx.slicer.step;
    if (step !== void 0 && !isNoteTime(step)) throw new ForgeFormatError(`${where}: fx.slicer.step must be a note length such as "1/16", got ${JSON.stringify(step)}`);
    f.num("depth", 0, 1);
    f.num("attack", 0, 100, false, "ms");
    f.num("release", 0, 500, false, "ms");
    f.num("gap", 0, 200, false, "ms");
  });
  effect(fx, "crush", where, (f) => {
    f.only(["bits", "rate", "mix"]);
    f.num("bits", 1, 16, false, "bits");
    f.num("rate", 200, 48e3, false, "Hz");
    f.num("mix", 0, 1);
    const c = fx.crush;
    if (c.bits === void 0 && c.rate === void 0) throw new ForgeFormatError(`${where}: fx.crush needs bits, rate or both`);
  });
  effect(fx, "tape", where, (f) => {
    f.only(["drive", "wow", "flutter", "tone", "hiss"]);
    for (const k of ["drive", "wow", "flutter", "hiss"]) f.num(k, 0, 1);
    f.num("tone", 1e3, 2e4, false, "Hz");
  });
  for (const name of ["tremolo", "autopan"]) {
    effect(fx, name, where, (f) => {
      f.only(["rate", "depth", "shape", "phase"]);
      f.rate("rate");
      f.num("depth", 0, 1);
      f.oneOf("shape", LFO_SHAPES);
      f.num("phase", 0, 1);
    });
  }
  checkAutomation(channel.automation, CHANNEL_PARAMS, where, (name) => fx[name] !== void 0);
}
function checkMasterFx(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ForgeFormatError("master must be an object");
  const master = value;
  checkEq(master.eq, "master");
  if (master.reverb !== void 0) {
    const r = master.reverb;
    if (!r || typeof r !== "object") throw new ForgeFormatError("master.reverb must be an object like { room, damp, wet }");
    const rf = new Fields(r, "master.reverb");
    rf.only(["room", "damp", "wet", "preDelayMs", "type"]);
    rf.oneOf("type", SPACE_TYPES);
  }
  const f = new Fields(master, "master");
  f.num("width", 0, 2);
  f.num("monoBelow", 20, 500, false, "Hz");
  checkAutomation(master.automation, MASTER_PARAMS, "master", (effect2) => master[effect2] !== void 0);
}

// src/sound/tune.ts
var TUNE_FORMAT = "forge/tune@1";
var DRUM_SYMBOLS = {
  k: "kick",
  s: "snare",
  h: "hat",
  o: "openhat",
  c: "crash",
  p: "clap",
  t: "tom",
  r: "ride"
};
var DRUM_LETTERS = {
  kick: "k",
  snare: "s",
  hat: "h",
  openhat: "o",
  crash: "c",
  clap: "p",
  tom: "t",
  ride: "r"
};
var DRIVE_TONE_RANGE = { low: 200, high: 2e4 };
var DRIVE_LOW_RANGE = { low: 20, high: 1e3 };
var DRIVE_MODE_NAMES = ["soft", "hard", "fold"];
var DUCK_RELEASE_MAX = 1e4;
var ARTICULATIONS = ["normal", "ring", "legato"];
var DEFAULT_ENVELOPE = { attack: 0, decay: 60, sustain: 0.7, release: 90 };
function createChannel(name, options = {}) {
  return {
    name,
    voice: "pulse25",
    role: "melody",
    step: "1/8",
    octave: 4,
    volume: 0.8,
    pan: 0,
    envelope: { ...DEFAULT_ENVELOPE },
    steps: "",
    ...options
  };
}
function stepDenominator(step) {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(step.trim());
  if (!match) throw new ForgeFormatError(`Cannot parse the step: ${step}`);
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator !== 1) throw new ForgeFormatError(`Only 1/N steps are supported, got ${step}`);
  return denominator;
}
function stepsPerBar(tune, channel) {
  const [beats, beatUnit] = tune.meter;
  return Math.round(beats * stepDenominator(channel.step) / beatUnit);
}
function holdChar(cell) {
  if (cell.value === "-") return "-";
  if (cell.mod === cell.value && (cell.value === "<" || cell.value === ">" || cell.value === "~")) {
    return cell.value;
  }
  return null;
}
function parseCells(steps) {
  const body = steps.replace(/[|\s]/g, "");
  if (body.length % 2 !== 0) {
    throw new ForgeFormatError(
      `A tracker row must consist of two-character cells, got ${body.length} characters`
    );
  }
  const cells = [];
  for (let i = 0; i < body.length; i += 2) cells.push({ mod: body[i], value: body[i + 1] });
  return cells;
}
function channelLanes(channel) {
  if (Array.isArray(channel.steps)) return channel.steps.length > 0 ? [...channel.steps] : [""];
  return [channel.steps];
}
function channelNotes(tune, channel) {
  return channelLanes(channel).flatMap((row, lane) => rowNotes(tune, channel, row, lane));
}
function rowNotes(tune, channel, row, lane) {
  const { root, scale } = parseKey(`${tune.key} ${tune.scale}`);
  const cells = parseCells(row);
  const notes = [];
  let current = null;
  cells.forEach((cell, index) => {
    const hold = holdChar(cell);
    if (hold !== null) {
      if (!current) {
        if (hold === "-") return;
        throw new ForgeFormatError(
          `A hold cell "${cell.mod}${cell.value}" at step ${index + 1} follows no note`
        );
      }
      current.steps++;
      current.holds += hold;
      if (hold === "~") {
        const next = cells[index + 1];
        if (!next || next.value === "." || holdChar(next) !== null) {
          throw new ForgeFormatError(`"~~" at step ${index + 1} must be followed by a note`);
        }
      }
      return;
    }
    if (cell.value === ".") {
      current = null;
      return;
    }
    const drum = DRUM_SYMBOLS[cell.value];
    if (channel.role === "drums") {
      if (!drum) throw new ForgeFormatError(`Unknown drum symbol: ${cell.value}`);
      current = { stepIndex: index, steps: 1, holds: "", midi: null, drum, accent: cell.mod === ">", lane };
      notes.push(current);
      return;
    }
    const degree = Number(cell.value);
    if (!Number.isInteger(degree) || degree < 1) {
      throw new ForgeFormatError(`Unknown row symbol: ${cell.mod}${cell.value}`);
    }
    const octaveShift = cell.mod === "^" ? 1 : cell.mod === "v" ? -1 : 0;
    const accidental = cell.mod === "#" ? 1 : cell.mod === "b" ? -1 : 0;
    current = {
      stepIndex: index,
      steps: 1,
      holds: "",
      midi: degreeToMidi(root, scale, degree, channel.octave + octaveShift, accidental),
      drum: null,
      accent: cell.mod === ">",
      lane
    };
    notes.push(current);
  });
  return notes;
}
function tuneSeconds(tune) {
  return tune.bars * tune.meter[0] * 60 / tune.tempo;
}
function parseArticulation(value, name) {
  if (!ARTICULATIONS.includes(value)) {
    throw new ForgeFormatError(
      `Channel ${name}: articulation must be ${ARTICULATIONS.join(", ")}, got ${String(value)}`
    );
  }
  return value;
}
function parseShape(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ForgeFormatError(`Channel ${name}: shape must be an object like { attack, release }`);
  }
  const raw = value;
  const shape = {};
  for (const key of ["attack", "release"]) {
    if (raw[key] === void 0) continue;
    const ms = raw[key];
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > 1e4) {
      throw new ForgeFormatError(`Channel ${name}: shape.${key} must be 0 \u2026 10000 ms, got ${String(ms)}`);
    }
    shape[key] = ms;
  }
  return shape;
}
var isNumberIn = (value, low, high) => typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;
function checkDriveDuck(channel) {
  const fx = channel.fx;
  if (!fx || typeof fx !== "object") return;
  const where = `Channel ${channel.name}`;
  if (fx.drive !== void 0) {
    const d = fx.drive;
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new ForgeFormatError(`${where}: fx.drive must be an object like { amount, tone, mix }`);
    if (!isNumberIn(d.amount, 0, 1)) throw new ForgeFormatError(`${where}: fx.drive.amount must be 0 \u2026 1, got ${String(d.amount)}`);
    if (d.tone !== void 0 && !isNumberIn(d.tone, DRIVE_TONE_RANGE.low, DRIVE_TONE_RANGE.high)) {
      throw new ForgeFormatError(`${where}: fx.drive.tone must be ${DRIVE_TONE_RANGE.low} \u2026 ${DRIVE_TONE_RANGE.high} Hz, got ${String(d.tone)}`);
    }
    if (d.mix !== void 0 && !isNumberIn(d.mix, 0, 1)) throw new ForgeFormatError(`${where}: fx.drive.mix must be 0 \u2026 1, got ${String(d.mix)}`);
    if (d.mode !== void 0 && !DRIVE_MODE_NAMES.includes(d.mode)) {
      throw new ForgeFormatError(`${where}: fx.drive.mode must be one of ${DRIVE_MODE_NAMES.join(", ")}, got ${String(d.mode)}`);
    }
    if (d.low !== void 0 && !isNumberIn(d.low, DRIVE_LOW_RANGE.low, DRIVE_LOW_RANGE.high)) {
      throw new ForgeFormatError(`${where}: fx.drive.low must be ${DRIVE_LOW_RANGE.low} \u2026 ${DRIVE_LOW_RANGE.high} Hz, got ${String(d.low)}`);
    }
  }
  if (fx.duck !== void 0) {
    const d = fx.duck;
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new ForgeFormatError(`${where}: fx.duck must be an object like { channel, drums, depth, release }`);
    if (typeof d.channel !== "string" || d.channel === "") throw new ForgeFormatError(`${where}: fx.duck.channel must name a drum channel`);
    if (d.drums !== void 0 && (typeof d.drums !== "string" || d.drums === "" || [...d.drums].some((l) => !(l in DRUM_SYMBOLS)))) {
      throw new ForgeFormatError(`${where}: fx.duck.drums must be drum letters (${Object.keys(DRUM_SYMBOLS).join("")}), got ${String(d.drums)}`);
    }
    if (!isNumberIn(d.depth, 0, 1)) throw new ForgeFormatError(`${where}: fx.duck.depth must be 0 \u2026 1, got ${String(d.depth)}`);
    if (!isNumberIn(d.release, 0, DUCK_RELEASE_MAX)) throw new ForgeFormatError(`${where}: fx.duck.release must be 0 \u2026 ${DUCK_RELEASE_MAX} ms, got ${String(d.release)}`);
  }
}
function parseTune(input) {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || typeof data !== "object") throw new ForgeFormatError("Empty track document");
  if (data.format !== void 0 && data.format !== TUNE_FORMAT) {
    throw new ForgeFormatError(`Unknown format: ${String(data.format)}`);
  }
  const bars = Number(data.bars ?? 8);
  const meterRaw = Array.isArray(data.meter) ? data.meter : [4, 4];
  const channels = (Array.isArray(data.channels) ? data.channels : []).map((raw) => {
    const channel = raw;
    if (!channel.name) throw new ForgeFormatError("A channel without a name");
    const shape = channel.shape !== void 0 ? parseShape(channel.shape, String(channel.name)) : void 0;
    return createChannel(String(channel.name), {
      voice: channel.voice ?? "pulse25",
      role: channel.role ?? "melody",
      step: String(channel.step ?? "1/8"),
      octave: Number(channel.octave ?? 4),
      volume: Number(channel.volume ?? 0.8),
      pan: Number(channel.pan ?? 0),
      envelope: { ...DEFAULT_ENVELOPE, ...channel.envelope ?? {} },
      steps: Array.isArray(channel.steps) ? channel.steps.map(String) : String(channel.steps ?? ""),
      ...channel.instrument !== void 0 ? { instrument: String(channel.instrument) } : {},
      ...channel.fx !== void 0 ? { fx: channel.fx } : {},
      ...channel.humanize !== void 0 ? { humanize: Number(channel.humanize) } : {},
      ...channel.dynamics !== void 0 ? { dynamics: Number(channel.dynamics) } : {},
      ...channel.sample !== void 0 ? { sample: channel.sample } : {},
      ...channel.articulation !== void 0 ? { articulation: parseArticulation(channel.articulation, String(channel.name)) } : {},
      ...shape !== void 0 && Object.keys(shape).length > 0 ? { shape } : {},
      ...channel.automation !== void 0 ? { automation: channel.automation } : {}
    });
  });
  for (const channel of channels) {
    checkDriveDuck(channel);
    checkChannelFx(channel);
  }
  if (data.master !== void 0) checkMasterFx(data.master);
  const sections = (Array.isArray(data.sections) ? data.sections : []).map((raw) => {
    const section = raw;
    return {
      name: String(section.name ?? "A"),
      from: Number(section.from ?? 0),
      bars: Number(section.bars ?? bars)
    };
  });
  return {
    format: TUNE_FORMAT,
    name: String(data.name ?? ""),
    brief: String(data.brief ?? ""),
    tempo: Number(data.tempo ?? 120),
    meter: [Number(meterRaw[0] ?? 4), Number(meterRaw[1] ?? 4)],
    key: String(data.key ?? "c"),
    scale: data.scale ?? "major",
    profile: data.profile ?? "nes",
    ...data.loop !== void 0 ? { loop: data.loop === true } : {},
    bars,
    sections: sections.length > 0 ? sections : [{ name: "A", from: 0, bars }],
    channels,
    ...data.master !== void 0 ? { master: data.master } : {}
  };
}

// src/sound/samplelib.ts
var INSTRUMENT_FORMAT = "forge/instrument@1";
var DEFAULT_DYNAMICS = 0.6;
var DRUM_LETTERS2 = ["k", "s", "h", "o", "c", "p", "t", "r"];
var ROLES = ["melody", "harmony", "bass", "drums"];
function fail(field, why) {
  throw new ForgeFormatError(`instrument manifest: ${field} ${why}`);
}
function obj(v, field) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(field, "must be an object");
  return v;
}
function str(o, key, path) {
  const v = o[key];
  if (typeof v !== "string" || v === "") fail(`${path}${key}`, "must be a non-empty string");
  return v;
}
function num(o, key, path, min = -Infinity, max = Infinity, int = false) {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}${key}`, "must be a number");
  if (int && !Number.isInteger(v)) fail(`${path}${key}`, "must be an integer");
  if (v < min || v > max) fail(`${path}${key}`, `must be within ${min}..${max}`);
  return v;
}
function optNum(o, key, path, min = -Infinity, int = false) {
  if (o[key] !== void 0) num(o, key, path, min, Infinity, int);
}
function parseInstrumentManifest(input) {
  const o = obj(input, "manifest");
  if (o.format !== INSTRUMENT_FORMAT) fail("format", `must be "${INSTRUMENT_FORMAT}"`);
  const id = str(o, "id", "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail("id", "must be lowercase letters, digits and dashes");
  str(o, "name", "");
  str(o, "category", "");
  if (typeof o.description !== "string") fail("description", "must be a string");
  if (!ROLES.includes(o.role)) fail("role", `must be one of ${ROLES.join(", ")}`);
  const low = num(o, "low", "", 0, 127, true);
  const high = num(o, "high", "", 0, 127, true);
  if (low > high) fail("low", "must not exceed high");
  num(o, "gm", "", 0, 127, true);
  num(o, "release", "", 0);
  if (typeof o.sustain !== "boolean") fail("sustain", "must be a boolean");
  if (o.drums !== void 0) {
    const d = obj(o.drums, "drums");
    for (const k of Object.keys(d)) {
      if (!DRUM_LETTERS2.includes(k)) fail(`drums.${k}`, "is not a drum letter");
      num(d, k, "drums.", 0, 127, true);
    }
  }
  const lic = obj(o.licence, "licence");
  str(lic, "name", "licence.");
  str(lic, "url", "licence.");
  str(lic, "author", "licence.");
  str(lic, "source", "licence.");
  if (lic.attribution !== void 0 && typeof lic.attribution !== "string") {
    fail("licence.attribution", "must be a string");
  }
  if (!Array.isArray(o.zones)) fail("zones", "must be an array");
  o.zones.forEach((zv, i) => {
    const p = `zones[${i}].`;
    const z = obj(zv, `zones[${i}]`);
    const file = str(z, "file", p);
    if (/^([/\\]|[A-Za-z]:)/.test(file) || file.split(/[/\\]/).includes("..")) {
      fail(`${p}file`, "must be a relative path without ..");
    }
    num(z, "root", p, 0, 127, true);
    const lo = num(z, "lo", p, 0, 127, true);
    const hi = num(z, "hi", p, 0, 127, true);
    if (lo > hi) fail(`${p}lo`, "must not exceed hi");
    const vl = num(z, "velLo", p, 1, 127, true);
    const vh = num(z, "velHi", p, 1, 127, true);
    if (vl > vh) fail(`${p}velLo`, "must not exceed velHi");
    optNum(z, "rr", p, 1, true);
    optNum(z, "loopStart", p, 0, true);
    optNum(z, "loopEnd", p, 0, true);
    if (z.loopStart !== void 0 && z.loopEnd !== void 0 && z.loopStart >= z.loopEnd) {
      fail(`${p}loopStart`, "must be below loopEnd");
    }
    optNum(z, "gainDb", p);
    if (!/^[0-9a-f]{64}$/.test(str(z, "sha256", p))) fail(`${p}sha256`, "must be 64 lowercase hex characters");
    num(z, "bytes", p, 0, Infinity, true);
  });
  return input;
}
function layerVelocity(dynamics, accent, jitter) {
  const d = (dynamics ?? DEFAULT_DYNAMICS) + (accent ? 0.2 : 0) + jitter;
  return Math.round(Math.min(1, Math.max(0, d)) * 126) + 1;
}
function chooseZone(m, midi, velocity, rrIndex) {
  const zs = m.zones;
  if (zs.length === 0) return -1;
  let pool = [];
  zs.forEach((z, i) => {
    if (midi >= z.lo && midi <= z.hi) pool.push(i);
  });
  if (pool.length === 0) pool = zs.map((_, i) => i);
  const dist = (i) => {
    const z = zs[i];
    return velocity < z.velLo ? z.velLo - velocity : velocity > z.velHi ? velocity - z.velHi : 0;
  };
  let bestD = Infinity;
  for (const i of pool) bestD = Math.min(bestD, dist(i));
  const near = pool.filter((i) => dist(i) === bestD);
  const first = near.reduce((a, b) => zs[b].velLo < zs[a].velLo || zs[b].velLo === zs[a].velLo && zs[b].velHi < zs[a].velHi ? b : a);
  const layer = near.filter((i) => zs[i].velLo === zs[first].velLo && zs[i].velHi === zs[first].velHi);
  let bestR = Infinity;
  for (const i of layer) bestR = Math.min(bestR, Math.abs(zs[i].root - midi));
  const rootPool = layer.filter((i) => Math.abs(zs[i].root - midi) === bestR);
  const root = zs[rootPool[0]].root;
  const group = rootPool.filter((i) => zs[i].root === root);
  group.sort((a, b) => (zs[a].rr ?? 1) - (zs[b].rr ?? 1) || a - b);
  return group[(rrIndex % group.length + group.length) % group.length];
}
function channelPitches(tune, channel, m) {
  const out = /* @__PURE__ */ new Set();
  for (const note of channelNotes(tune, channel)) {
    if (note.drum) {
      const root = m.drums?.[DRUM_LETTERS[note.drum]];
      if (root !== void 0) out.add(root);
    } else if (note.midi !== null) {
      out.add(note.midi);
    }
  }
  return [...out].sort((a, b) => a - b);
}
function neededZones(m, pitches) {
  const sizes = /* @__PURE__ */ new Map();
  let rrCount = 0;
  for (const z of m.zones) {
    const key = `${z.root}/${z.velLo}/${z.velHi}`;
    const n = (sizes.get(key) ?? 0) + 1;
    sizes.set(key, n);
    rrCount = Math.max(rrCount, n);
  }
  const out = /* @__PURE__ */ new Set();
  for (const p of pitches) {
    for (let v = 1; v <= 127; v++) {
      for (let rr = 0; rr < rrCount; rr++) out.add(chooseZone(m, p, v, rr));
    }
  }
  out.delete(-1);
  return [...out].sort((a, b) => a - b);
}
function buildInstrument(m, files) {
  const zones = m.zones.map(() => void 0);
  for (const [i, bytes] of files) {
    const z = m.zones[i];
    if (!z) continue;
    try {
      const flac = decodeFlac(bytes);
      zones[i] = { channels: flac.channels, sampleRate: flac.sampleRate };
    } catch (e) {
      throw new Error(`instrument "${m.id}": ${z.file}: ${e.message}`);
    }
  }
  return { manifest: m, zones };
}

// src/web/sample-loader.ts
var UnknownInstrumentError = class extends Error {
  constructor(instrument, message) {
    super(message);
    this.instrument = instrument;
    this.name = "UnknownInstrumentError";
  }
  instrument;
};
var ID_RE = /^[a-z0-9][a-z0-9-]*$/;
var SampleLoader = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  manifests = /* @__PURE__ */ new Map();
  instruments = /* @__PURE__ */ new Map();
  /** Fetched (not cached: it is small and may change) and memoised for the session. */
  manifest(id) {
    if (!ID_RE.test(id)) return Promise.reject(new UnknownInstrumentError(id, `invalid instrument id "${id}": lowercase letters, digits and dashes only`));
    let p = this.manifests.get(id);
    if (!p) {
      p = this.fetchManifest(id);
      this.manifests.set(id, p);
      p.catch(() => this.manifests.delete(id));
    }
    return p;
  }
  async load(id, zones, onProgress) {
    const m = await this.manifest(id);
    let inst = this.instruments.get(id);
    if (!inst) {
      inst = buildInstrument(m, /* @__PURE__ */ new Map());
      this.instruments.set(id, inst);
    }
    const wanted = [...new Set(zones)];
    for (const i of wanted) {
      if (!Number.isInteger(i) || i < 0 || i >= m.zones.length) throw new Error(`instrument "${id}": no zone ${i}`);
    }
    const missing = wanted.filter((i) => !inst.zones[i]);
    const total2 = wanted.length;
    let done = total2 - missing.length;
    onProgress?.({ instrument: id, done, total: total2 });
    const files = /* @__PURE__ */ new Map();
    await Promise.all(missing.map(async (i) => {
      files.set(i, await this.zoneBytes(id, m, i));
      onProgress?.({ instrument: id, done: ++done, total: total2 });
    }));
    const built = buildInstrument(m, files);
    for (const i of missing) inst.zones[i] = built.zones[i];
    return inst;
  }
  async fetchManifest(id) {
    const url = `${this.deps.baseUrl}${id}/instrument.json`;
    let res;
    try {
      res = await this.deps.fetch(url);
    } catch (e) {
      throw new Error(`instrument "${id}": instrument.json: ${e.message}`);
    }
    if (res.status === 404) throw new UnknownInstrumentError(id, `instrument "${id}": not in the sample library`);
    if (!res.ok) throw new Error(`instrument "${id}": instrument.json: HTTP ${res.status}`);
    const manifest = parseInstrumentManifest(await res.json());
    if (manifest.id !== id) throw new Error(`instrument "${id}": its manifest says id "${manifest.id}"`);
    return manifest;
  }
  /** Zone URLs are built from the requested id, the one the manifest was fetched under. */
  async zoneBytes(id, m, index) {
    const zone = m.zones[index];
    const url = `${this.deps.baseUrl}${id}/${zone.file}`;
    const valid = async (d) => d.length === zone.bytes && await this.deps.sha256(d) === zone.sha256;
    const cached = await this.deps.cache.get(url);
    if (cached) {
      if (await valid(cached)) return cached;
      await this.deps.cache.delete(url);
    }
    const data = await this.download(id, zone.file, url);
    if (!await valid(data)) throw new Error(`instrument "${id}": ${zone.file} failed its checksum`);
    await this.deps.cache.put(url, data);
    return data;
  }
  async download(id, file, url) {
    let res;
    try {
      res = await this.deps.fetch(url);
    } catch (e) {
      throw new Error(`instrument "${id}": ${file}: ${e.message}`);
    }
    if (!res.ok) throw new Error(`instrument "${id}": ${file}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
};
var CACHE_NAME = "forge-samples-v1";
function browserDeps(baseUrl2) {
  let opened;
  const open = () => {
    if (!opened) {
      const storage = globalThis.caches;
      const p = storage ? Promise.resolve().then(() => storage.open(CACHE_NAME)) : Promise.reject(new Error("no Cache Storage"));
      opened = p;
      p.catch(() => {
        if (opened === p) opened = void 0;
      });
    }
    return opened;
  };
  const cache = {
    async get(url) {
      try {
        const hit = await (await open()).match(url);
        return hit ? new Uint8Array(await hit.arrayBuffer()) : void 0;
      } catch {
        return void 0;
      }
    },
    async put(url, data) {
      try {
        await (await open()).put(url, new Response(data));
      } catch {
      }
    },
    async delete(url) {
      try {
        await (await open()).delete(url);
      } catch {
      }
    }
  };
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    cache,
    sha256: async (d) => {
      const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", d));
      return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
    },
    baseUrl: baseUrl2
  };
}

// src/sound/sampled.ts
var VAR_CENTS = 3;
var VAR_DB = 1;
var VAR_START_MS = 4;
var VAR_START_DRUM_MS = 1;
var LOOP_FADE_S = 0.02;
var EDGE_FADE_S = 2e-3;
var START_FADE_S = 1e-3;
function renderSampledHit(inst, target, offset, hit, rrIndex) {
  const m = inst.manifest;
  const zi = chooseZone(m, hit.midi, hit.velocity, rrIndex);
  if (zi < 0) return;
  const z = m.zones[zi];
  const loaded = inst.zones[zi];
  if (!loaded) throw new Error(`instrument "${m.id}": zone ${zi} (${z.file}) is not loaded`);
  if (loaded.channels.length === 0) return;
  const chans = loaded.channels;
  const nc = chans.length;
  const len = Math.min(...chans.map((c) => c.length));
  if (len < 2) return;
  const scale = Math.min(2, Math.max(0, hit.humanize / 0.25));
  const varCents = (hit.rng() * 2 - 1) * VAR_CENTS * scale;
  const varDb = (hit.rng() * 2 - 1) * VAR_DB * scale;
  const startMs = hit.rng() * (hit.drum ? VAR_START_DRUM_MS : VAR_START_MS) * scale;
  const outRate = hit.sampleRate;
  const ratio = 2 ** ((hit.midi + varCents / 100 - z.root) / 12) * (loaded.sampleRate / outRate);
  const gain = hit.gain * 10 ** (((z.gainDb ?? 0) + varDb) / 20);
  const start = Math.min(len - 2, (startMs / 1e3 + (hit.skipSeconds ?? 0)) * loaded.sampleRate);
  const at2 = (k) => {
    const i = k < 0 ? 0 : k >= len ? len - 1 : k;
    if (nc === 1) return chans[0][i];
    let s = 0;
    for (let c = 0; c < nc; c++) s += chans[c][i];
    return s / nc;
  };
  const interp = (pos2) => {
    const k = Math.floor(pos2);
    const x = pos2 - k;
    const p0 = at2(k - 1);
    const p1 = at2(k);
    const p2 = at2(k + 1);
    const p3 = at2(k + 2);
    return 0.5 * (2 * p1 + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x * x + (-p0 + 3 * p1 - 3 * p2 + p3) * x * x * x);
  };
  const loopEnd = Math.min(z.loopEnd ?? -1, len);
  const loopStart = z.loopStart ?? -1;
  const looping = m.sustain && !hit.drum && loopStart >= 0 && loopEnd > loopStart && start < loopEnd;
  const loopLen = loopEnd - loopStart;
  const xfade = looping ? Math.min(Math.round(LOOP_FADE_S * loaded.sampleRate), loopStart, Math.floor(loopLen / 2)) : 0;
  const edgeN = Math.max(1, Math.round(EDGE_FADE_S * outRate));
  const sourceEnd = looping ? Infinity : Math.ceil((len - 1 - start) / ratio);
  const held = Math.max(0, Math.round(hit.heldSamples));
  const relN = Math.max(edgeN, Math.round((hit.releaseSeconds ?? m.release) * outRate));
  const noteEnd = hit.drum ? Infinity : held + relN;
  const n = Math.min(sourceEnd, noteEnd);
  if (!Number.isFinite(n)) return;
  const startN = start > 0 ? Math.max(1, Math.round(START_FADE_S * outRate)) : 0;
  let pos = start;
  for (let i = 0; i < n; i++, pos += ratio) {
    if (looping) while (pos >= loopEnd) pos -= loopLen;
    const t = offset + i;
    if (t >= target.length) break;
    if (t < 0) continue;
    let v;
    if (xfade > 0 && pos >= loopEnd - xfade) {
      const w = (pos - (loopEnd - xfade)) / xfade;
      v = (1 - w) * interp(pos) + w * interp(pos - loopLen);
    } else {
      v = interp(pos);
    }
    let env = 1;
    if (i < startN) env *= (i + 1) / startN;
    if (!hit.drum && i >= held) env *= 1 - (i - held) / relN;
    if (sourceEnd - i <= edgeN) env *= (sourceEnd - 1 - i) / edgeN;
    target[t] += v * env * gain;
  }
}

// src/sound/analyze.ts
function kWeight(channel, rate) {
  const out = new Float64Array(channel.length);
  const G = 3.99984385397;
  const Q1 = 0.7071752369554193;
  const f1 = 1681.974450955532;
  const K1 = Math.tan(Math.PI * f1 / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.499666774155;
  const a0 = 1 + K1 / Q1 + K1 * K1;
  const sb0 = (Vh + Vb * K1 / Q1 + K1 * K1) / a0;
  const sb1 = 2 * (K1 * K1 - Vh) / a0;
  const sb2 = (Vh - Vb * K1 / Q1 + K1 * K1) / a0;
  const sa1 = 2 * (K1 * K1 - 1) / a0;
  const sa2 = (1 - K1 / Q1 + K1 * K1) / a0;
  const Q2 = 0.5003270373253953;
  const f2 = 38.13547087613982;
  const K2 = Math.tan(Math.PI * f2 / rate);
  const ha1 = 2 * (K2 * K2 - 1) / (1 + K2 / Q2 + K2 * K2);
  const ha2 = (1 - K2 / Q2 + K2 * K2) / (1 + K2 / Q2 + K2 * K2);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let u1 = 0, u2 = 0, v1 = 0, v2 = 0;
  for (let i = 0; i < channel.length; i++) {
    const x = channel[i];
    const y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    const z = y - 2 * u1 + u2 - ha1 * v1 - ha2 * v2;
    u2 = u1;
    u1 = y;
    v2 = v1;
    v1 = z;
    out[i] = z;
  }
  return out;
}
function loudnessLufs(channels, rate) {
  const weighted = channels.map((c) => kWeight(c, rate));
  const n = weighted[0]?.length ?? 0;
  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  const energies = [];
  const blockEnergy = (from, to) => {
    let total2 = 0;
    for (const w of weighted) {
      let s = 0;
      for (let i = from; i < to; i++) s += w[i] * w[i];
      total2 += s / Math.max(1, to - from);
    }
    return total2;
  };
  if (n < block) energies.push(blockEnergy(0, n));
  else for (let from = 0; from + block <= n; from += hop) energies.push(blockEnergy(from, from + block));
  const lufs = (e) => -0.691 + 10 * Math.log10(Math.max(e, 1e-12));
  const absolute = energies.filter((e) => lufs(e) > -70);
  if (absolute.length === 0) return -70;
  const meanAbs = absolute.reduce((a, b) => a + b, 0) / absolute.length;
  const relative = absolute.filter((e) => lufs(e) > lufs(meanAbs) - 10);
  const use = relative.length > 0 ? relative : absolute;
  return lufs(use.reduce((a, b) => a + b, 0) / use.length);
}

// src/sound/articulation.ts
var SHAPE_FLOOR_DB = -30;
var LEGATO_FADE_S = 0.03;
var RING_CAP_S = 8;
var SUSTAINING_SYNTHS = /* @__PURE__ */ new Set(["lead", "bass", "pad", "strings", "brass", "flute", "organ"]);
function ringSustains(channel, manifest) {
  if (channel.instrument && !isInstrument(channel.instrument)) {
    if (!manifest || !manifest.sustain) return () => false;
    return (note) => {
      if (note.midi === null) return false;
      const index = chooseZone(manifest, note.midi, layerVelocity(channel.dynamics, note.accent, 0), 0);
      const z = index >= 0 ? manifest.zones[index] : void 0;
      return z !== void 0 && z.loopStart !== void 0 && z.loopEnd !== void 0 && z.loopEnd > z.loopStart;
    };
  }
  const id = channel.instrument;
  if (id === "sampler") return () => channel.sample?.loop === true;
  return () => id === void 0 || SUSTAINING_SYNTHS.has(id);
}
function channelUsesShape(channel, notes) {
  if (channel.articulation !== void 0 && channel.articulation !== "normal") return true;
  if (channel.shape !== void 0 && Object.keys(channel.shape).length > 0) return true;
  return notes.some((note) => /[<>~]/.test(note.holds));
}
function boundaryLevels(note) {
  if (!/[<>]/.test(note.holds)) return null;
  const modes = [note.holds[0] === "<" ? "<" : "-", ...note.holds.split("")];
  const levels = [note.holds[0] === "<" ? SHAPE_FLOOR_DB : 0];
  let k = 0;
  while (k < modes.length) {
    let end = k + 1;
    if (modes[k] === "<" || modes[k] === ">") {
      while (end < modes.length && modes[end] === modes[k]) end++;
    }
    const from = levels[k];
    const target = modes[k] === "<" ? 0 : modes[k] === ">" ? SHAPE_FLOOR_DB : from;
    const run = end - k;
    for (let i = 1; i <= run; i++) levels.push(from + (target - from) * i / run);
    k = end;
  }
  return levels;
}
function buildCurve(note, length, stepSamples) {
  const levels = boundaryLevels(note);
  if (!levels) return null;
  const curve = new Float32Array(length);
  const last = levels[levels.length - 1];
  for (let i = 0; i < length; i++) {
    const pos = i / stepSamples;
    const k = Math.floor(pos);
    const dbValue = k >= levels.length - 1 ? last : levels[k] + (levels[k + 1] - levels[k]) * (pos - k);
    curve[i] = Math.pow(10, dbValue / 20);
  }
  return curve;
}
function planChannel(tune, channel, notes, rate, manifest) {
  const stepSeconds2 = 60 / tune.tempo * (4 / stepDenominator(channel.step));
  const stepSamples = stepSeconds2 * rate;
  const articulation = channel.articulation ?? "normal";
  const totalSteps = tune.bars * stepsPerBar(tune, channel);
  const lanes = channelLanes(channel);
  const sustains = articulation === "ring" ? ringSustains(channel, manifest) : () => false;
  const capSamples = Math.round(RING_CAP_S * rate);
  const rests = lanes.map((row) => {
    const set = [];
    parseCells(row).forEach((cell, index) => {
      if (cell.value === ".") set.push(index);
    });
    return set;
  });
  const byLane = /* @__PURE__ */ new Map();
  for (const note of notes) {
    const list = byLane.get(note.lane) ?? [];
    list.push(note);
    byLane.set(note.lane, list);
  }
  const position = /* @__PURE__ */ new Map();
  for (const list of byLane.values()) {
    list.sort((a, b) => a.stepIndex - b.stepIndex);
    list.forEach((n, i) => position.set(n, i));
  }
  const joins = (prev, next) => prev.holds.endsWith("~") || articulation === "legato" && prev.stepIndex + prev.steps === next.stepIndex;
  return notes.map((note) => {
    const list = byLane.get(note.lane);
    const at2 = position.get(note);
    const prev = at2 > 0 ? list[at2 - 1] : null;
    const next = at2 < list.length - 1 ? list[at2 + 1] : null;
    const noteEnd = note.stepIndex + note.steps;
    const legatoOut = next !== null && joins(note, next) && noteEnd === next.stepIndex;
    const ring = articulation === "ring" && !legatoOut;
    let endStep = noteEnd;
    if (ring) {
      const rest = rests[note.lane]?.find((r) => r >= noteEnd);
      let until = rest ?? totalSteps;
      if (next !== null && sustains(note)) until = Math.min(until, next.stepIndex);
      endStep = Math.max(endStep, until);
    }
    const start = Math.round(note.stepIndex * stepSamples);
    let endSample = Math.round(endStep * stepSamples);
    if (ring) endSample = Math.min(endSample, Math.round(noteEnd * stepSamples) + capSamples);
    const held = Math.max(1, endSample - start);
    const ownLength = Math.min(held, Math.max(1, Math.round(noteEnd * stepSamples) - start));
    return {
      note,
      start,
      held,
      ring,
      legatoIn: prev !== null && joins(prev, note) && prev.stepIndex + prev.steps === note.stepIndex,
      legatoOut,
      curve: buildCurve(note, ownLength, stepSamples),
      attackMs: channel.shape?.attack ?? 0,
      releaseMs: channel.shape?.release ?? null
    };
  });
}

// src/sound/studio.ts
function instrumentOf(channel) {
  if (channel.instrument && isInstrument(channel.instrument)) return channel.instrument;
  switch (channel.role) {
    case "bass":
      return "bass";
    case "harmony":
      return "pad";
    default:
      return "lead";
  }
}
function delaySeconds(time, tempo) {
  const ms = /^(\d+(?:\.\d+)?)\s*ms$/i.exec(time.trim());
  if (ms) return Number(ms[1]) / 1e3;
  if (/^\s*1\s*\/\s*\d+\s*$/.test(time)) return 60 / tempo * (4 / stepDenominator(time));
  return noteSeconds(time, tempo);
}
var plainDelay = (d) => (d.mode ?? "lean") === "lean" && d.tone === void 0 && d.low === void 0 && !d.drive && !d.wobble && !d.duck;
function stepSeconds(tune, channel) {
  return 60 / tune.tempo * (4 / stepDenominator(channel.step));
}
var ACCENT_GAIN = 1.25;
function duckHits(tune, channel, repeats, rate) {
  const duck = channel.fx?.duck;
  if (!duck) return [];
  const source = tune.channels.find((c) => c.name === duck.channel);
  if (!source || source.role !== "drums") return [];
  const kinds = new Set([...duck.drums ?? "k"].map((letter) => DRUM_SYMBOLS[letter]));
  const step = stepSeconds(tune, source);
  const loop = tuneSeconds(tune);
  const steps = [...new Set(channelNotes(tune, source).filter((n) => n.drum !== null && kinds.has(n.drum)).map((n) => n.stepIndex))];
  const hits = [];
  for (let pass = 0; pass < Math.max(1, repeats); pass++) {
    for (const s of steps) hits.push(Math.round((pass * loop + s * step) * rate));
  }
  return [...new Set(hits)].sort((a, b) => a - b);
}
function noteTriggers(tune, channel, passes, rate) {
  const notes = channelNotes(tune, channel);
  const step = stepSeconds(tune, channel);
  const loop = tuneSeconds(tune);
  const lastEnd = /* @__PURE__ */ new Map();
  const fired = [];
  for (const n of [...notes].sort((a, b) => a.stepIndex - b.stepIndex)) {
    const prev = lastEnd.get(n.lane);
    const slurred = prev !== void 0 && prev.holds.endsWith("~") && prev.stepIndex + prev.steps === n.stepIndex;
    lastEnd.set(n.lane, n);
    if (!slurred) fired.push(n);
  }
  const out = [];
  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    for (const n of fired) {
      out.push({ at: Math.round((pass * loop + n.stepIndex * step) * rate), strength: n.accent ? 1.5 : 1, midi: n.midi });
    }
  }
  return out.sort((a, b) => a.at - b.at || (b.midi ?? 0) - (a.midi ?? 0));
}
function filterOctaves(ctx, filter, length) {
  const { tune, channel, rate } = ctx;
  const env = filter.env && filter.env.amount !== 0 ? filter.env : void 0;
  const wave = filter.lfo && filter.lfo.depth > 0 ? filter.lfo : void 0;
  const key = filter.key ?? 0;
  if (!env && !wave && key === 0) return void 0;
  const oct = new Float32Array(length);
  const triggers = env || key ? noteTriggers(tune, channel, ctx.timeline.passes, rate) : [];
  if (env) {
    const e = triggerEnvelope(length, rate, triggers, env.attack ?? 2, env.decay ?? 250);
    for (let i = 0; i < length; i++) oct[i] += env.amount * e[i];
  }
  if (wave) {
    const seed = seedOf(tune.name || "tune") ^ seedOf(`${channel.name}:filter`);
    const l = lfo(length, rate, rateHz(wave.rate, tune.tempo), wave.shape ?? "sine", wave.phase ?? 0, seed);
    for (let i = 0; i < length; i++) oct[i] += wave.depth * l[i];
  }
  if (key) {
    let midi = 60;
    let k = 0;
    for (let i = 0; i < length; i++) {
      while (k < triggers.length && triggers[k].at <= i) {
        const t = triggers[k++];
        if (t.midi !== null && (k === 1 || triggers[k - 2].at !== t.at)) midi = t.midi;
      }
      oct[i] += key * (midi - 60) / 12;
    }
  }
  return oct;
}
function timelineOf(tune, options = {}) {
  const rate = options.sampleRate ?? 44100;
  const loopSeconds = tuneSeconds(tune);
  return {
    rate,
    barSeconds: loopSeconds / Math.max(1, tune.bars),
    loopSeconds,
    passes: Math.max(1, Math.floor(options.repeats ?? 1)),
    length: studioLength(tune, options).total
  };
}
function applyChannelFx(mono, ctx) {
  const { tune, rate, lanes } = ctx;
  const fx = ctx.channel.fx;
  let signal = mono;
  const eq = fx?.eq;
  eqHighpass(signal, eq, lanes, rate);
  const filter = fx?.filter;
  if (filter) {
    svf(signal, rate, {
      type: filter.type ?? "lowpass",
      cutoff: lanes.param("filter.cutoff", filter.cutoff),
      resonance: lanes.param("filter.resonance", filter.resonance ?? 0.2),
      slope: filter.slope ?? 12,
      octaves: filterOctaves(ctx, filter, signal.length)
    });
  }
  const d = fx?.drive;
  if (d && (lanes.has("drive.amount") || d.amount > 0) && (lanes.has("drive.mix") || (d.mix ?? 1) > 0)) {
    signal = drive(signal, rate, {
      ...d,
      amount: lanes.param("drive.amount", d.amount),
      ...d.tone !== void 0 || lanes.has("drive.tone") ? { tone: lanes.param("drive.tone", d.tone ?? 6e3) } : {},
      ...d.mix !== void 0 || lanes.has("drive.mix") ? { mix: lanes.param("drive.mix", d.mix ?? 1) } : {}
    });
  }
  if (fx?.crush) {
    const c = fx.crush;
    signal = crush(signal, rate, {
      ...c.bits !== void 0 ? { bits: lanes.param("crush.bits", c.bits) } : {},
      ...c.rate !== void 0 ? { rate: lanes.param("crush.rate", c.rate) } : {},
      mix: lanes.param("crush.mix", c.mix ?? 1)
    });
  }
  eqRest(signal, eq, lanes, rate);
  if (fx?.gate) {
    const g = fx.gate;
    gate(signal, rate, { threshold: g.threshold, range: g.range ?? -80, attack: g.attack ?? 1, hold: g.hold ?? 40, release: g.release ?? 80 });
  }
  if (fx?.transient) transient(signal, rate, { attack: fx.transient.attack ?? 0, sustain: fx.transient.sustain ?? 0 });
  const comp = fx?.comp;
  if (comp) {
    compress([signal], rate, {
      thresholdDb: comp.threshold,
      ratio: comp.ratio,
      ...comp.attack !== void 0 ? { attackMs: comp.attack } : {},
      ...comp.release !== void 0 ? { releaseMs: comp.release } : {},
      ...comp.knee !== void 0 ? { kneeDb: comp.knee } : {},
      ...comp.makeup !== void 0 ? { makeupDb: comp.makeup } : {}
    });
  }
  if (fx?.tape) signal = tapeOf(ctx, fx.tape, signal);
  if (fx?.tremolo) {
    const t = fx.tremolo;
    const wave = waveOf(ctx, "tremolo", t.rate ?? "1/8", t.shape ?? "sine", t.phase ?? 0, signal.length);
    const depth = lanes.param("tremolo.depth", t.depth ?? 0.5);
    for (let i = 0; i < signal.length; i++) signal[i] *= 1 - at(depth, i) * 0.5 * (1 - wave[i]);
  }
  if (fx?.slicer) {
    const sl = fx.slicer;
    const g = slicerGain(signal.length, rate, sl.pattern, noteSeconds(sl.step ?? "1/16", tune.tempo), {
      attack: sl.attack ?? 2,
      release: sl.release ?? 20,
      gapMs: sl.gap ?? 12
    });
    const depth = lanes.param("slicer.depth", sl.depth ?? 1);
    for (let i = 0; i < signal.length; i++) signal[i] *= 1 - at(depth, i) * (1 - g[i]);
  }
  let left = signal;
  let right = signal;
  if (fx?.phaser) {
    const p = fx.phaser;
    const opts = (phase) => ({
      wave: waveOf(ctx, "phaser", p.rate ?? 0.3, p.shape ?? "sine", phase, signal.length),
      depth: lanes.param("phaser.depth", p.depth ?? 0.8),
      feedback: p.feedback ?? 0.4,
      stages: p.stages ?? 6,
      mix: lanes.param("phaser.mix", p.mix ?? 0.7),
      low: p.low ?? 300,
      high: p.high ?? 3500
    });
    [left, right] = stereoPair(left, right, p.stereo ?? 0.25, (x, phase) => phaser(x, rate, opts(phase)));
  }
  if (fx?.flanger) {
    const f = fx.flanger;
    const opts = (phase) => ({
      wave: waveOf(ctx, "flanger", f.rate ?? 0.2, f.shape ?? "sine", phase, signal.length),
      depth: lanes.param("flanger.depth", f.depth ?? 0.7),
      feedback: f.feedback ?? 0.5,
      mix: lanes.param("flanger.mix", f.mix ?? 0.6),
      delayMs: f.delay ?? 1
    });
    [left, right] = stereoPair(left, right, f.stereo ?? 0.25, (x, phase) => flanger(x, rate, opts(phase)));
  }
  const pre = left === right ? left : middle(left, right);
  const [preL, preR] = [left, right];
  const chorusMix = lanes.curve("chorus") ?? fx?.chorus;
  if (chorusMix) {
    const inR = right;
    left = chorus(left, rate, { mix: chorusMix, phase: 0 });
    right = chorus(inR, rate, { mix: chorusMix, phase: 0.5, rateHz: 0.7 });
  }
  signal = pre;
  if (fx?.delay && !plainDelay(fx.delay)) {
    const d2 = fx.delay;
    const mode = d2.mode ?? "lean";
    const samples = (t) => Math.max(1, Math.round(delaySeconds(t, tune.tempo) * rate));
    const [wl, wr] = echoes(mode === "lean" ? pre : preL, mode === "lean" ? pre : preR, rate, {
      mode: mode === "lean" ? "mono" : mode,
      delayL: samples(d2.time),
      delayR: samples(d2.timeR ?? d2.time),
      feedback: lanes.param("delay.feedback", d2.feedback),
      tone: d2.tone ?? 4500,
      ...d2.low !== void 0 ? { low: d2.low } : {},
      ...d2.drive ? { drive: d2.drive } : {},
      ...d2.wobble ? { wobble: d2.wobble } : {},
      ...d2.duck ? { duck: d2.duck } : {}
    });
    const mix = lanes.param("delay.mix", d2.mix);
    if (left === right) right = left.slice();
    if (left === pre || left === preL) left = left.slice();
    if (right === preR) right = right.slice();
    const [gl, gr] = mode === "lean" ? [0.7, 1] : [1, 1];
    for (let i = 0; i < left.length; i++) {
      const m = at(mix, i);
      left[i] += wl[i] * m * gl;
      right[i] += wr[i] * m * gr;
    }
  } else if (fx?.delay) {
    const time = delaySeconds(fx.delay.time, tune.tempo);
    const wet = echo(signal, rate, { timeMs: time * 1e3, feedback: lanes.param("delay.feedback", fx.delay.feedback) });
    const mix = lanes.param("delay.mix", fx.delay.mix);
    left = left === signal ? signal.slice() : left;
    right = right === signal ? signal.slice() : right;
    for (let i = 0; i < signal.length; i++) {
      const m = typeof mix === "number" ? mix : mix[i];
      left[i] += wet[i] * m * 0.7;
      right[i] += wet[i] * m;
    }
  }
  if (fx?.space) {
    const sp = fx.space;
    const type = sp.type ?? "room";
    const def = SPACE_DEFAULTS[type];
    const [wl, wr] = space(left, right, rate, {
      type,
      size: sp.size ?? def.size,
      damp: sp.damp ?? def.damp,
      preDelayMs: sp.preDelay ?? def.preDelay,
      width: sp.width ?? 1
    });
    const g = sp.gate ? onsetGate(left, right, rate, sp.gate) : null;
    const mix = lanes.param("space.mix", sp.mix ?? 0.3);
    if (left === right) right = left.slice();
    for (let i = 0; i < left.length; i++) {
      const m = at(mix, i) * (g ? g[i] : 1);
      left[i] += wl[i] * m;
      right[i] += wr[i] * m;
    }
  }
  if (fx?.haas) [left, right] = haas(left, right, fx.haas, rate);
  const width = lanes.curve("width") ?? fx?.width;
  if (width !== void 0 && width !== 1 && left !== right) widthInPlace(left, right, width);
  return { left, right };
}
function eqHighpass(signal, eq, lanes, rate) {
  const hp = lanes.curve("eq.hp") ?? eq?.hp;
  if (hp) slopedPass(signal, "highpass", hp, rate, eq?.hpSlope ?? 12);
}
function eqRest(signal, eq, lanes, rate) {
  const band = (name) => lanes.curve(`eq.${name}`) ?? eq?.[name];
  const lp = lanes.curve("eq.lp") ?? eq?.lp;
  if (lp) slopedPass(signal, "lowpass", lp, rate, eq?.lpSlope ?? 12);
  const low = band("low");
  if (low) filterParamInPlace(signal, "lowshelf", 120, rate, 0.7071, low);
  const mid = band("mid");
  if (mid) filterParamInPlace(signal, "peak", 1e3, rate, 0.9, mid);
  const high = band("high");
  if (high) filterParamInPlace(signal, "highshelf", 8e3, rate, 0.7071, high);
  if (eq?.bands?.length) eqBands(signal, eq.bands, rate);
}
function smoothed(x, seconds, rate) {
  const k = 1 - Math.exp(-1 / (seconds * rate));
  let y = x[0] ?? 0;
  for (let i = 0; i < x.length; i++) {
    y += (x[i] - y) * k;
    x[i] = y;
  }
  return x;
}
function tapeOf(ctx, tape, input) {
  const { rate } = ctx;
  const n = input.length;
  const wow = tape.wow ?? 0.3;
  const flutter = tape.flutter ?? 0.2;
  let signal = input;
  if (wow > 0 || flutter > 0) {
    const drift = smoothed(waveOf(ctx, "tape-drift", 0.4, "random", 0, n), 1, rate);
    const jitter = smoothed(waveOf(ctx, "tape-jitter", 20, "random", 0, n), 0.015, rate);
    signal = wowFlutter(signal, rate, wow, flutter, drift, jitter);
  }
  const amount = tape.drive ?? 0.3;
  const tone = tape.tone ?? 9e3;
  if (amount > 0) signal = drive(signal, rate, { amount: 0.35 * amount, tone, mode: "soft" });
  else slopedPass(signal, "lowpass", tone, rate, 12);
  const hiss = tape.hiss ?? 0;
  if (hiss > 0) {
    let e = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(signal[i]) > 1e-4) {
        e += signal[i] * signal[i];
        count++;
      }
    }
    const target = Math.sqrt(e / Math.max(1, count)) * dbToGain(-50 + 25 * hiss);
    const rng = createRng(seedOf(ctx.tune.name || "tune") ^ seedOf(`${ctx.channel.name}:hiss`));
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) noise[i] = rng() * 2 - 1;
    slopedPass(noise, "highpass", 400, rate, 12);
    slopedPass(noise, "lowpass", Math.min(tone, 8e3), rate, 12);
    let en = 0;
    for (let i = 0; i < n; i++) en += noise[i] * noise[i];
    const scale = en > 0 ? target / Math.sqrt(en / n) : 0;
    if (signal === input) signal = input.slice();
    for (let i = 0; i < n; i++) signal[i] += noise[i] * scale;
  }
  return signal;
}
function middle(left, right) {
  const out = new Float32Array(left.length);
  for (let i = 0; i < out.length; i++) out[i] = (left[i] + right[i]) * 0.5;
  return out;
}
function stereoPair(left, right, offset, run) {
  if (left === right && offset === 0) {
    const both = run(left, 0);
    return [both, both];
  }
  return [run(left, 0), run(right, offset)];
}
function waveOf(ctx, effect2, rate, shape, phase, length) {
  const seed = seedOf(ctx.tune.name || "tune") ^ seedOf(`${ctx.channel.name}:${effect2}`);
  return lfo(length, ctx.rate, rateHz(rate, ctx.tune.tempo), shape, phase, seed);
}
var faderGain = (db2) => db2 <= -60 ? 0 : dbToGain(db2);
function studioLength(tune, options = {}) {
  const rate = options.sampleRate ?? 44100;
  const repeats = Math.max(1, Math.floor(options.repeats ?? 1));
  const body = Math.round(tuneSeconds(tune) * repeats * rate);
  const tailSeconds = options.tail ?? 3;
  return { body, total: body + Math.round(tailSeconds * rate) };
}
var LEGATO_SKIP_S = 0.08;
function voicesOf(plans, fadeN) {
  const voices = /* @__PURE__ */ new Map();
  for (let i = 0; i < plans.length; i++) {
    const first = plans[i];
    let j = i;
    while (j + 1 < plans.length && plans[j].legatoOut && plans[j + 1].legatoIn && plans[j + 1].note.lane === first.note.lane && first.note.drum === null && plans[j + 1].note.midi !== null && plans[j + 1].note.midi === first.note.midi) j++;
    const last = plans[j];
    const base = first.start;
    const held = last.start - base + last.held;
    let curve = null;
    if (plans.slice(i, j + 1).some((p) => p.curve !== null)) {
      const lastLength = Math.max(last.curve ? last.curve.length : 1, j > i ? fadeN + 1 : 1);
      curve = new Float32Array(last.start - base + lastLength).fill(1);
      for (let k = i; k <= j; k++) {
        const p = plans[k];
        if (!p.curve) continue;
        const from = p.start - base;
        const to = k < j ? plans[k + 1].start - base : curve.length;
        for (let x = from; x < to; x++) curve[x] = p.curve[Math.min(x - from, p.curve.length - 1)];
      }
      for (let k = i + 1; k <= j; k++) {
        const at2 = plans[k].start - base;
        const from = curve[at2 - 1];
        const end = Math.min(curve.length, at2 + fadeN);
        for (let x = at2; x < end; x++) {
          const u = (x - at2) / fadeN;
          curve[x] = from + (curve[x] - from) * u;
        }
      }
    }
    voices.set(i, { first, last, held, curve });
    i = j;
  }
  return voices;
}
function skipOf(inst, zone) {
  const z = inst.manifest.zones[zone];
  const loaded = inst.zones[zone];
  if (z.loopStart !== void 0 && loaded) return z.loopStart / loaded.sampleRate;
  return LEGATO_SKIP_S;
}
function quietVelocity(inst, midi) {
  const zones = inst.manifest.zones;
  let pool = zones.filter((z) => midi >= z.lo && midi <= z.hi);
  if (pool.length === 0) pool = zones;
  const layers = new Set(pool.map((z) => `${z.velLo}:${z.velHi}`));
  if (layers.size < 2) return null;
  return Math.min(...pool.map((z) => z.velLo));
}
var LAYER_BLOCK_S = 0.02;
function crossfadeLayers(full, soft, curve, held, rate) {
  let ef = 0;
  let es = 0;
  for (let i = 0; i < held; i++) {
    ef += full[i] * full[i];
    es += soft[i] * soft[i];
  }
  const match = es > 0 ? Math.sqrt(ef / es) : 0;
  const block = Math.max(1, Math.round(LAYER_BLOCK_S * rate));
  const blocks = Math.ceil(full.length / block);
  const gains = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let eFull = 0;
    let eMix = 0;
    const end = Math.min(full.length, (b + 1) * block);
    for (let i = b * block; i < end; i++) {
      const level = gainToDb(curve[Math.min(i, curve.length - 1)]);
      const w = Math.min(1, Math.max(0, (level - SHAPE_FLOOR_DB) / -SHAPE_FLOOR_DB));
      const mix = Math.sqrt(w) * full[i] + Math.sqrt(1 - w) * soft[i] * match;
      eFull += full[i] * full[i];
      eMix += mix * mix;
      soft[i] = mix;
    }
    gains[b] = eFull > 0 && eMix > 0 ? Math.min(4, Math.max(0.25, Math.sqrt(eFull / eMix))) : 1;
  }
  for (let i = 0; i < full.length; i++) {
    const p = (i + 0.5) / block - 0.5;
    const b0 = Math.max(0, Math.min(blocks - 1, Math.floor(p)));
    const b1 = Math.min(blocks - 1, b0 + 1);
    const u = Math.max(0, Math.min(1, p - b0));
    full[i] = soft[i] * (gains[b0] + (gains[b1] - gains[b0]) * u);
  }
}
function renderShapedNotes(ctx) {
  const { tune, channel, notes, rate, scratch, rng, humanize, instrument, sampled, sample } = ctx;
  const plans = planChannel(tune, channel, notes, rate, sampled?.manifest);
  const fadeN = Math.max(1, Math.round(LEGATO_FADE_S * rate));
  const voices = voicesOf(plans, fadeN);
  let rrIndex = 0;
  for (let pass = 0; pass < ctx.repeats; pass++) {
    const passOffset = pass * ctx.loopSeconds;
    const laneShift = /* @__PURE__ */ new Map();
    for (let n = 0; n < plans.length; n++) {
      const plan = plans[n];
      const note = plan.note;
      const jitter = channel.role === "drums" ? 0.35 : 1;
      const timing = (rng() - 0.5) * 0.012 * humanize * jitter;
      let shift = Math.round((passOffset + timing) * rate);
      if (plan.legatoIn && laneShift.has(note.lane)) shift = laneShift.get(note.lane);
      shift = Math.max(shift, -plan.start);
      laneShift.set(note.lane, shift);
      const start = plan.start + shift;
      let hitVelocity = 0;
      let velocity = 0;
      let midi = note.midi;
      if (sampled) {
        hitVelocity = layerVelocity(channel.dynamics, note.accent, (rng() - 0.5) * 0.1 * humanize);
        if (note.drum) {
          const root = sampled.manifest.drums?.[DRUM_LETTERS[note.drum]];
          midi = root === void 0 ? null : root;
        }
        if (midi === null) continue;
      } else {
        const dyn = 1 + (rng() - 0.5) * 0.2 * humanize;
        velocity = Math.min(1, channel.volume * (note.accent ? ACCENT_GAIN : 1) * dyn);
      }
      if (note.drum) {
        if (sampled) {
          renderSampledHit(sampled, scratch, start, {
            midi,
            velocity: hitVelocity,
            heldSamples: plan.held,
            sampleRate: rate,
            rng,
            humanize,
            gain: channel.volume,
            drum: true
          }, rrIndex++);
        } else {
          renderStudioDrum(scratch, start, note.drum, velocity, rate, rng);
        }
        continue;
      }
      if (midi === null) continue;
      const voice = voices.get(n);
      if (!voice) continue;
      const room = Math.max(0, scratch.length - start);
      const { first, last, curve } = voice;
      const legatoIn = first.legatoIn;
      const legatoOut = last.legatoOut;
      const join = voice.held;
      const holdLen = legatoOut ? join + fadeN : voice.held;
      const attackN = legatoIn ? 0 : Math.round(first.attackMs / 1e3 * rate);
      const releaseMs = last.releaseMs;
      let body;
      if (sampled) {
        const m = sampled.manifest;
        const zone = chooseZone(m, midi, hitVelocity, rrIndex);
        const releaseSeconds = releaseMs === null ? void 0 : releaseMs / 1e3;
        const relN = Math.round((releaseSeconds ?? m.release) * rate) + 2;
        const length = Math.min(room, legatoOut ? join + fadeN : holdLen + relN);
        const hitOf = (vel, z, draw) => ({
          midi,
          velocity: vel,
          heldSamples: holdLen,
          sampleRate: rate,
          rng: draw,
          humanize,
          gain: channel.volume,
          drum: false,
          releaseSeconds,
          ...legatoIn && z >= 0 ? { skipSeconds: skipOf(sampled, z) } : {}
        });
        body = new Float32Array(length);
        const drawn = [];
        const record = () => {
          const v = rng();
          drawn.push(v);
          return v;
        };
        renderSampledHit(sampled, body, 0, hitOf(hitVelocity, zone, record), rrIndex);
        const quiet = curve ? quietVelocity(sampled, midi) : null;
        const quietZone = quiet === null ? -1 : chooseZone(m, midi, quiet, rrIndex);
        if (curve && quiet !== null && quietZone >= 0 && zone >= 0 && (m.zones[quietZone].velLo !== m.zones[zone].velLo || m.zones[quietZone].velHi !== m.zones[zone].velHi)) {
          let k = 0;
          const replay = () => k < drawn.length ? drawn[k++] : rng();
          const soft = new Float32Array(length);
          renderSampledHit(sampled, soft, 0, hitOf(quiet, quietZone, replay), rrIndex);
          crossfadeLayers(body, soft, curve, Math.min(join, length), rate);
        }
        rrIndex++;
      } else {
        const skipN = legatoIn ? Math.round(LEGATO_SKIP_S * rate) : 0;
        const releaseN = releaseMs === null || legatoOut ? 0 : Math.max(1, Math.round(EDGE_FADE_S * rate), Math.round(releaseMs / 1e3 * rate));
        const job = {
          freq: midiToFreq(midi),
          samples: Math.max(1, holdLen + releaseN + skipN),
          velocity,
          sampleRate: rate,
          rng,
          sample,
          ...legatoIn ? { legato: true } : {}
        };
        const end = legatoOut ? join + fadeN : releaseN > 0 ? holdLen + releaseN : noteSamples(instrument, job) - skipN;
        const length = Math.max(0, Math.min(room, end));
        const raw = new Float32Array(length + skipN);
        renderNote(instrument, raw, 0, job);
        body = skipN > 0 ? raw.subarray(skipN) : raw;
        if (releaseN > 0) for (let i = holdLen; i < length; i++) body[i] *= Math.max(0, 1 - (i - holdLen) / releaseN);
      }
      let used = body.length;
      while (used > 0 && body[used - 1] === 0) used--;
      for (let i = 0; i < used; i++) {
        let g = curve ? curve[Math.min(i, curve.length - 1)] : 1;
        if (i < attackN) g *= i / attackN;
        if (legatoIn && i < fadeN) g *= Math.sin(Math.PI / 2 * (i / fadeN));
        if (legatoOut && i >= join) g *= i - join < fadeN ? Math.cos(Math.PI / 2 * ((i - join) / fadeN)) : 0;
        scratch[start + i] += body[i] * g;
      }
    }
  }
}
function renderChannel(tune, channel, options = {}) {
  const rate = options.sampleRate ?? 44100;
  const repeats = Math.max(1, Math.floor(options.repeats ?? 1));
  const loopSeconds = tuneSeconds(tune);
  const { total: total2 } = studioLength(tune, options);
  const baseSeed = seedOf(tune.name || "tune");
  const scratch = new Float32Array(total2);
  const rng = createRng(baseSeed ^ seedOf(channel.name));
  const humanize = channel.humanize ?? 0.25;
  const notes = channelNotes(tune, channel);
  const step = stepSeconds(tune, channel);
  const instrument = instrumentOf(channel);
  let sampled;
  if (channel.instrument && !isInstrument(channel.instrument)) {
    sampled = options.library?.get(channel.instrument);
    if (!sampled) throw new Error(`channel "${channel.name}": unknown instrument "${channel.instrument}" \u2014 not a synth and not in the sample library`);
  }
  let rrIndex = 0;
  let sample;
  if (instrument === "sampler") {
    if (!channel.sample) throw new Error(`channel "${channel.name}": a sampler needs "sample": { "file": "...", "root": "c4" }`);
    if (!options.loadSample) throw new Error("a sampler channel needs a sample loader (render through the CLI)");
    const root = /^\d+$/.test(channel.sample.root) ? Number(channel.sample.root) : nameToMidi(channel.sample.root);
    sample = options.loadSample(channel.sample.file, root, channel.sample.loop === true);
  }
  if (channelUsesShape(channel, notes)) {
    renderShapedNotes({ tune, channel, notes, rate, repeats, loopSeconds, scratch, rng, humanize, instrument, sampled, sample });
  } else for (let pass = 0; pass < repeats; pass++) {
    const passOffset = pass * loopSeconds;
    for (const note of notes) {
      const jitter = channel.role === "drums" ? 0.35 : 1;
      const timing = (rng() - 0.5) * 0.012 * humanize * jitter;
      const start = Math.max(0, Math.round((passOffset + note.stepIndex * step + timing) * rate));
      if (sampled) {
        const hitVelocity = layerVelocity(channel.dynamics, note.accent, (rng() - 0.5) * 0.1 * humanize);
        let midi = note.midi;
        if (note.drum) {
          const root = sampled.manifest.drums?.[DRUM_LETTERS[note.drum]];
          midi = root === void 0 ? null : root;
        }
        if (midi === null) continue;
        renderSampledHit(sampled, scratch, start, {
          midi,
          velocity: hitVelocity,
          heldSamples: Math.max(1, Math.round(note.steps * step * rate)),
          sampleRate: rate,
          rng,
          humanize,
          gain: channel.volume,
          drum: note.drum !== null
        }, rrIndex++);
        continue;
      }
      const dyn = 1 + (rng() - 0.5) * 0.2 * humanize;
      const velocity = Math.min(1, channel.volume * (note.accent ? ACCENT_GAIN : 1) * dyn);
      if (note.drum) {
        renderStudioDrum(scratch, start, note.drum, velocity, rate, rng);
        continue;
      }
      if (note.midi === null) continue;
      renderNote(instrument, scratch, start, {
        freq: midiToFreq(note.midi),
        samples: Math.max(1, Math.round(note.steps * step * rate)),
        velocity,
        sampleRate: rate,
        rng,
        sample
      });
    }
  }
  const timeline = timelineOf(tune, options);
  const lanes = new Lanes(channel.automation, CHANNEL_PARAMS, timeline);
  let { left, right } = applyChannelFx(scratch, { tune, channel, rate, lanes, timeline });
  const level = lanes.curve("level");
  if (level) {
    if (right === left) right = left.slice();
    for (let i = 0; i < total2; i++) {
      const g = faderGain(level[i]);
      left[i] *= g;
      right[i] *= g;
    }
  }
  const duck = channel.fx?.duck;
  if (duck && duck.depth > 0) {
    const loopSamples = loopSeconds * rate;
    const passes = options.seamless ? Math.max(repeats, Math.ceil(total2 / loopSamples)) : repeats;
    const hits = duckHits(tune, channel, passes, rate);
    if (hits.length > 0) {
      const gain = duckEnvelope(total2, rate, hits, { depth: duck.depth, releaseMs: duck.release });
      for (let i = 0; i < total2; i++) left[i] *= gain[i];
      if (right !== left) for (let i = 0; i < total2; i++) right[i] *= gain[i];
    }
  }
  const sendCurve = lanes.curve("reverb");
  const send = sendCurve ? 1 : Math.max(0, Math.min(1, channel.fx?.reverb ?? 0));
  let panCurve = lanes.curve("pan");
  const autopan = channel.fx?.autopan;
  if (autopan) {
    const ctx = { tune, channel, rate, lanes, timeline };
    const wave = waveOf(ctx, "autopan", autopan.rate ?? "1/2", autopan.shape ?? "sine", autopan.phase ?? 0, total2);
    const depth = lanes.param("autopan.depth", autopan.depth ?? 0.7);
    const swung = new Float32Array(total2);
    for (let i = 0; i < total2; i++) swung[i] = (panCurve ? panCurve[i] : channel.pan) + at(depth, i) * wave[i];
    panCurve = swung;
  }
  if (panCurve) {
    if (right === left) right = left.slice();
    for (let i = 0; i < total2; i++) {
      const angle2 = (Math.max(-1, Math.min(1, panCurve[i])) + 1) * Math.PI / 4;
      left[i] *= Math.cos(angle2) * Math.SQRT2;
      right[i] *= Math.sin(angle2) * Math.SQRT2;
    }
    return { left, right, gainL: 1, gainR: 1, send, ...sendCurve ? { sendCurve } : {} };
  }
  const pan = Math.max(-1, Math.min(1, channel.pan));
  const angle = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(angle) * Math.SQRT2;
  const gr = Math.sin(angle) * Math.SQRT2;
  return { left, right, gainL: gl, gainR: gr, send, ...sendCurve ? { sendCurve } : {} };
}
function mixMaster(tune, channels, options = {}, gain = {}) {
  const rate = options.sampleRate ?? 44100;
  const { body: bodySamples, total: total2 } = studioLength(tune, options);
  const dryL = new Float32Array(total2);
  const dryR = new Float32Array(total2);
  const sendL = new Float32Array(total2);
  const sendR = new Float32Array(total2);
  for (const ch of channels) {
    const { send, gainL, gainR, sendCurve } = ch;
    for (let i = 0; i < total2; i++) {
      dryL[i] += ch.left[i] * gainL;
      dryR[i] += ch.right[i] * gainR;
      if (sendCurve) {
        const k = Math.max(0, Math.min(1, sendCurve[i]));
        sendL[i] += ch.left[i] * gainL * k;
        sendR[i] += ch.right[i] * gainR * k;
      } else if (send > 0) {
        sendL[i] += ch.left[i] * gainL * send;
        sendR[i] += ch.right[i] * gainR * send;
      }
    }
  }
  const master = tune.master ?? {};
  const lanes = new Lanes(master.automation, MASTER_PARAMS, timelineOf(tune, options));
  const room = master.reverb;
  const wetCurve = lanes.curve("reverb.wet");
  if (room && (room.wet > 0 || wetCurve)) {
    const wet = room.type ? (([left, right]) => ({ left, right }))(space(sendL, sendR, rate, {
      type: room.type,
      size: room.room,
      damp: room.damp,
      preDelayMs: room.preDelayMs ?? SPACE_DEFAULTS[room.type].preDelay,
      width: 1
    })) : reverb(sendL, sendR, rate, { room: room.room, damp: room.damp, preDelayMs: room.preDelayMs });
    for (let i = 0; i < total2; i++) {
      const w = wetCurve ? wetCurve[i] : room.wet;
      dryL[i] += wet.left[i] * w;
      dryR[i] += wet.right[i] * w;
    }
  }
  if (master.eq || lanes.has("eq.hp") || lanes.has("eq.lp") || lanes.has("eq.low") || lanes.has("eq.mid") || lanes.has("eq.high")) {
    for (const side of [dryL, dryR]) {
      eqHighpass(side, master.eq, lanes, rate);
      eqRest(side, master.eq, lanes, rate);
    }
  }
  if (master.comp) compress([dryL, dryR], rate, { thresholdDb: master.comp.threshold, ratio: master.comp.ratio, attackMs: 20, releaseMs: 200 });
  const width = lanes.curve("width") ?? master.width;
  if (width !== void 0 && width !== 1) widthInPlace(dryL, dryR, width);
  if (master.monoBelow) monoBelow(dryL, dryR, master.monoBelow, rate);
  const level = lanes.curve("level");
  if (level) {
    for (let i = 0; i < total2; i++) {
      const g = faderGain(level[i]);
      dryL[i] *= g;
      dryR[i] *= g;
    }
  }
  let outL = dryL;
  let outR = dryR;
  if (options.seamless) {
    for (let i = bodySamples; i < total2; i++) {
      dryL[i - bodySamples] += dryL[i];
      dryR[i - bodySamples] += dryR[i];
    }
    outL = dryL.slice(0, bodySamples);
    outR = dryR.slice(0, bodySamples);
  }
  const targetLufs = master.lufs === void 0 ? -18 : master.lufs;
  let lufsGain = 1;
  if (gain.lufsGain !== void 0) {
    lufsGain = gain.lufsGain;
  } else if (targetLufs !== null) {
    const now = loudnessLufs([outL, outR], rate);
    if (now > -69) lufsGain = dbToGain(targetLufs - now);
  }
  if (lufsGain !== 1) {
    for (let i = 0; i < outL.length; i++) {
      outL[i] *= lufsGain;
      outR[i] *= lufsGain;
    }
  }
  let peak = 0;
  for (let i = 0; i < outL.length; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  limit([outL, outR], master.ceiling ?? -1);
  return {
    left: outL,
    right: outR,
    sampleRate: rate,
    peak,
    clipped: gainToDb(peak) > 0,
    seconds: outL.length / rate,
    lufsGain
  };
}

// src/web/session.ts
var SAMPLE_RATE = 44100;
var TAIL = 3;
var PREVIEW_HOLD = 0.5;
var PREVIEW_RELEASE = 5;
var samplerWarning = (c) => `channel "${c.name}": a sampler plays a WAV from disk and cannot play on the page`;
var unknownInstrument = (c) => `channel "${c.name}": unknown instrument "${c.instrument}"`;
function channelKey(tune, channel) {
  const { name, tempo, meter, key, scale, bars, loop } = tune;
  const duck = channel.fx?.duck;
  const source = duck ? tune.channels.find((c) => c.name === duck.channel) : void 0;
  const duckSource = source ? { role: source.role, step: source.step, steps: source.steps } : null;
  return JSON.stringify({ channel, track: { name, tempo, meter, key, scale, bars, loop }, ...duck ? { duckSource } : {} });
}
var isSampler = (c) => instrumentOf(c) === "sampler";
var sampledId = (c) => c.instrument && !isInstrument(c.instrument) ? c.instrument : void 0;
var StudioSession = class {
  constructor(loader2, renderers = { renderChannel, mixMaster }) {
    this.loader = loader2;
    this.renderers = renderers;
  }
  loader;
  renderers;
  tune = null;
  audible = null;
  renders = /* @__PURE__ */ new Map();
  /** The full mix's loudness gain and what it was measured on. */
  gain = null;
  /** Takes a new version of the track; throws ForgeFormatError on a bad document. Renders nothing. */
  update(tune) {
    this.tune = parseTune(tune);
  }
  /** The channels that play; null plays them all. */
  setAudible(names) {
    this.audible = names === null ? null : new Set(names);
  }
  /** Channel names the next render will redo. */
  dirty() {
    const t = this.tune;
    if (!t) return [];
    return t.channels.filter((c) => !isSampler(c) && !this.renders.has(channelKey(t, c))).map((c) => c.name);
  }
  async render(onProgress) {
    const t = this.tune;
    if (!t) throw new Error("no track to render");
    const audible = this.audible;
    const options = { sampleRate: SAMPLE_RATE, tail: TAIL, repeats: 1, seamless: t.loop === true };
    const warnings = [];
    const playable = [];
    for (const c of t.channels) {
      if (isSampler(c)) warnings.push(samplerWarning(c));
      else playable.push(c);
    }
    const manifests = /* @__PURE__ */ new Map();
    for (const c of playable) {
      const id = sampledId(c);
      if (id === void 0 || manifests.has(id)) continue;
      manifests.set(id, await this.manifestOf(c));
    }
    const keys = playable.map((c) => channelKey(t, c));
    const heard = playable.map((c) => audible === null || audible.has(c.name));
    const everyone = heard.every(Boolean);
    const gainKey = JSON.stringify({ keys, master: t.master ?? null });
    const fullMix = everyone || this.gain?.key !== gainKey;
    const needed = playable.map((_, i) => fullMix || heard[i]);
    const todo = playable.filter((_, i) => needed[i] && !this.renders.has(keys[i]));
    const library = /* @__PURE__ */ new Map();
    const zones = /* @__PURE__ */ new Map();
    for (const c of todo) {
      const id = sampledId(c);
      if (id === void 0) continue;
      const m = manifests.get(id);
      const set = zones.get(id) ?? /* @__PURE__ */ new Set();
      for (const z of neededZones(m, channelPitches(t, c, m))) set.add(z);
      zones.set(id, set);
    }
    for (const [id, set] of zones) {
      const inst = await this.loader.load(id, [...set], (e) => onProgress?.({ phase: "download", label: e.instrument, done: e.done, total: e.total }));
      library.set(id, inst);
    }
    const fresh = /* @__PURE__ */ new Map();
    let done = 0;
    for (const c of todo) {
      onProgress?.({ phase: "render", label: c.name, done, total: todo.length });
      const key = channelKey(t, c);
      if (!fresh.has(key)) fresh.set(key, this.renderers.renderChannel(t, c, { ...options, library }));
      done++;
    }
    if (todo.length > 0) onProgress?.({ phase: "render", label: "", done, total: todo.length });
    const renderOf = (i) => fresh.get(keys[i]) ?? this.renders.get(keys[i]);
    onProgress?.({ phase: "mix", label: "master", done: 0, total: 1 });
    let lufsGain;
    let out;
    if (fullMix) {
      const all = this.renderers.mixMaster(t, playable.map((_, i) => renderOf(i)), options);
      lufsGain = all.lufsGain;
      this.gain = { key: gainKey, lufsGain };
      if (everyone) out = all;
    } else {
      lufsGain = this.gain.lufsGain;
    }
    if (!out) {
      const chans = playable.flatMap((_, i) => heard[i] ? [renderOf(i)] : []);
      out = this.renderers.mixMaster(t, chans, options, { lufsGain });
    }
    onProgress?.({ phase: "mix", label: "master", done: 1, total: 1 });
    for (const [key, r] of fresh) this.renders.set(key, r);
    const current = this.tune;
    const live = new Set(current ? current.channels.map((c) => channelKey(current, c)) : []);
    for (const key of [...this.renders.keys()]) if (!live.has(key)) this.renders.delete(key);
    return {
      left: out.left,
      right: out.right,
      sampleRate: out.sampleRate,
      seconds: out.seconds,
      barsSeconds: tuneSeconds(t),
      warnings
    };
  }
  /** One note of a channel, dry and mono, at the channel's volume: held at most 0.5 s, plus its release. */
  async preview(channel, cell) {
    const t = this.tune;
    if (!t) throw new Error("no track to preview");
    const c = t.channels.find((ch) => ch.name === channel);
    if (!c) throw new Error(`no channel "${channel}"`);
    if (isSampler(c)) throw new Error(samplerWarning(c));
    const rate = SAMPLE_RATE;
    const step = 60 / t.tempo * (4 / stepDenominator(c.step));
    const held = Math.max(1, Math.round(Math.min(PREVIEW_HOLD, cell.steps * step) * rate));
    const rng = createRng(seedOf(t.name || "tune") ^ seedOf(c.name));
    const drum = cell.drum;
    if (drum !== null && !(drum in DRUM_LETTERS)) throw new Error(`unknown drum "${cell.drum}"`);
    const empty = { data: new Float32Array(0), sampleRate: rate };
    const id = sampledId(c);
    let data;
    if (id !== void 0) {
      const m = await this.manifestOf(c);
      const midi = drum !== null ? m.drums?.[DRUM_LETTERS[drum]] : cell.midi;
      if (midi === void 0 || midi === null) return empty;
      const inst = await this.loader.load(id, neededZones(m, [midi]));
      data = new Float32Array(held + Math.round(PREVIEW_RELEASE * rate));
      renderSampledHit(inst, data, 0, {
        midi,
        velocity: layerVelocity(c.dynamics, false, 0),
        heldSamples: held,
        sampleRate: rate,
        rng,
        humanize: c.humanize ?? 0.25,
        gain: c.volume,
        drum: drum !== null
      }, 0);
    } else if (drum !== null) {
      data = new Float32Array(Math.round((STUDIO_DRUM_TAIL[drum] + 0.1) * rate));
      renderStudioDrum(data, 0, drum, Math.min(1, c.volume), rate, rng);
    } else {
      if (cell.midi === null) return empty;
      const instrument = instrumentOf(c);
      data = new Float32Array(held + Math.round(PREVIEW_RELEASE * rate));
      renderNote(instrument, data, 0, {
        freq: midiToFreq(cell.midi),
        samples: held,
        velocity: Math.min(1, c.volume),
        sampleRate: rate,
        rng
      });
    }
    let end = data.length;
    while (end > 0 && Math.abs(data[end - 1]) < 1e-5) end--;
    return { data: data.slice(0, end), sampleRate: rate };
  }
  /** An instrument missing from the library names the channel; any other failure keeps the loader's message. */
  async manifestOf(c) {
    try {
      return await this.loader.manifest(c.instrument);
    } catch (cause) {
      if (cause instanceof UnknownInstrumentError) throw new Error(unknownInstrument(c), { cause });
      throw new Error(`channel "${c.name}": ${cause.message}`, { cause });
    }
  }
};

// src/web/worker.ts
var baseUrl = DEFAULT_SAMPLE_BASE_URL;
var loader;
var sampleLoader = () => loader ??= new SampleLoader(browserDeps(baseUrl));
var session = new StudioSession({
  manifest: (id) => sampleLoader().manifest(id),
  load: (id, zones, onProgress) => sampleLoader().load(id, zones, onProgress)
});
var queue = Promise.resolve();
function receive(msg, post) {
  queue = queue.then(async () => {
    if (msg.type === "init") {
      if (msg.baseUrl !== baseUrl) loader = void 0;
      baseUrl = msg.baseUrl;
      post({ id: msg.id, type: "done", result: null });
      return;
    }
    await handle(session, msg, post);
  }).catch((e) => {
    try {
      post({ id: msg.id, type: "error", message: e instanceof Error ? e.message : String(e) });
    } catch {
    }
  });
}
self.onmessage = (e) => receive(e.data, (msg, transfer) => self.postMessage(msg, transfer ?? []));
