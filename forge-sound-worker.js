// source-hash: 1e0894c616390baff8b496b98dbeb9969367d0c0c6e19c0bfcf2319b1dd69f76
// src/sound/dsp.ts
var dbToGain = (db) => 10 ** (db / 20);
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
  const feedback = Math.min(0.95, Math.max(0, options.feedback));
  const line = new DelayLine(delaySamples + 2);
  const tone = new Biquad("lowpass", options.tone ?? 4500, sampleRate);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const wet = line.read(delaySamples);
    out[i] = wet;
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
    const lfo = Math.sin(2 * Math.PI * (rate * (i / sampleRate) + phase));
    const wet = line.read(base + depth * 0.5 * (1 + lfo));
    out[i] = input[i] * (1 - mix * 0.5) + wet * mix;
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
  let subPhase = 0;
  const velBright = spec.velocityBrightness ?? 0.5;
  for (let i = 0; i < n; i++) {
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    const amp = adsr(t, held, ...spec.env);
    if (amp <= 0 && t > held) continue;
    let vib = 1;
    if (spec.vibrato && t > spec.vibrato.delay) {
      const ramp = Math.min(1, (t - spec.vibrato.delay) / 0.3);
      vib = cents(Math.sin(2 * Math.PI * spec.vibrato.rate * t) * spec.vibrato.depthCents * ramp);
    }
    if (i % CONTROL === 0) {
      const open = spec.cutoff[2] + (spec.cutoff[1] - spec.cutoff[2]) * Math.exp(-t / spec.filterDecay);
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
    target[at] += v * amp * spec.gain * (0.35 + 0.65 * job.velocity);
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
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    const amp = adsr(t, held, 0.07, 0.1, 0.85, 0.15);
    const vib = t > 0.25 ? cents(Math.sin(2 * Math.PI * 5 * t) * 8 * Math.min(1, (t - 0.25) / 0.3)) : 1;
    phase += job.freq * vib / rate;
    const tone = Math.sin(2 * Math.PI * phase) + 0.22 * Math.sin(4 * Math.PI * phase) + 0.07 * Math.sin(6 * Math.PI * phase);
    const air = breath.process(job.rng() * 2 - 1) * (0.1 + 0.25 * Math.exp(-t / 0.08));
    target[at] += (tone * 0.5 + air) * amp * 0.5 * (0.35 + 0.65 * job.velocity);
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
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    const amp = adsr(t, held, 6e-3, 0, 1, 0.05);
    phase += job.freq * (1 + 4e-3 * Math.sin(2 * Math.PI * 6.2 * t)) / rate;
    let v = 0;
    for (let k = 0; k < ratios.length; k++) v += Math.sin(2 * Math.PI * phase * ratios[k]) * amps[k];
    v *= norm;
    v += click.process(job.rng() * 2 - 1) * 0.12 * Math.exp(-t / 4e-3);
    target[at] += v * amp * 0.6 * (0.4 + 0.6 * job.velocity);
  }
}
function epiano(target, offset, job) {
  const rate = job.sampleRate;
  const release = 0.25;
  const n = total(job, release) + Math.round(1.2 * rate);
  const held = job.samples / rate;
  const vel = 0.3 + 0.7 * job.velocity;
  for (let i = 0; i < n; i++) {
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    const decay = Math.exp(-t / (1.6 - 0.8 * Math.min(1, job.freq / 1500)));
    const releaseGain = t > held ? Math.max(0, 1 - (t - held) / release) : 1;
    if (releaseGain <= 0) break;
    const phi = 2 * Math.PI * job.freq * t;
    const body = Math.sin(phi + 1.4 * vel * Math.exp(-t / 0.6) * Math.sin(phi));
    const tine = Math.sin(phi + 2.8 * vel * Math.exp(-t / 0.05) * Math.sin(14 * phi));
    const tremolo = 1 + 0.03 * Math.sin(2 * Math.PI * 4.6 * t);
    target[at] += (body * 0.65 + tine * 0.28) * decay * releaseGain * tremolo * 0.8 * vel;
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
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    let v = 0;
    for (let k = 0; k < BELL_PARTIALS.length; k++) {
      const [ratio, amp, life] = BELL_PARTIALS[k];
      const f = job.freq * ratio * detune[k];
      if (f > rate * 0.45) continue;
      v += Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-t / (life * 0.4 * stretch));
    }
    v += strike.process(job.rng() * 2 - 1) * 0.35 * Math.exp(-t / 3e-3);
    target[at] += v * 0.28 * (0.35 + 0.65 * job.velocity);
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
    const at = offset + i;
    if (at >= target.length) break;
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
    if (at >= 0) target[at] += body.process(cur) * gain * 0.7 * (0.35 + 0.65 * job.velocity);
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
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
    const t = i / rate;
    const f = job.freq;
    let v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / life);
    v += 0.35 * Math.sin(2 * Math.PI * f * 3.9 * t) * Math.exp(-t / (life * 0.12));
    v += 0.1 * Math.sin(2 * Math.PI * f * 9.2 * t) * Math.exp(-t / (life * 0.05));
    v += knock.process(job.rng() * 2 - 1) * 0.3 * Math.exp(-t / 4e-3);
    target[at] += v * 0.6 * (0.35 + 0.65 * job.velocity);
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
    const at = offset + i;
    if (at < 0 || at >= target.length) continue;
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
    target[at] += v * amp * (0.35 + 0.65 * job.velocity);
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
      const at = offset + i;
      if (at < 0 || at >= target.length) continue;
      target[at] += fn(i / rate, i) * vel;
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
var BUNDLE_VERSION = true ? "1e0894c6 2026-10-20" : "dev";
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
      const at = this.pos >>> 3;
      if (at >= this.bytes.length) this.eof();
      const avail = 8 - (this.pos & 7);
      const take = avail < n ? avail : n;
      v = v * (1 << take) + (this.bytes[at] >> avail - take & (1 << take) - 1);
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
      const at = this.pos >>> 3;
      if (at >= this.bytes.length) this.eof();
      const off = this.pos & 7;
      const b = this.bytes[at] << off & 255;
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
  let at = 0;
  if (bytes.length >= 10 && bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    at = 10 + ((bytes[6] & 127) << 21) + ((bytes[7] & 127) << 14) + ((bytes[8] & 127) << 7) + (bytes[9] & 127);
  }
  if (bytes.length < at + 8 || bytes[at] !== 102 || bytes[at + 1] !== 76 || bytes[at + 2] !== 97 || bytes[at + 3] !== 67) {
    throw new ForgeFormatError('FLAC: not a FLAC stream (no "fLaC" marker)');
  }
  at += 4;
  let info = null;
  for (let last = false; !last; ) {
    if (at + 4 > bytes.length) throw new ForgeFormatError("FLAC: the metadata is cut short");
    last = (bytes[at] & 128) !== 0;
    const type = bytes[at] & 127;
    const length2 = bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3];
    const body = at + 4;
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
    at = body + length2;
  }
  const stream = info;
  if (stream.bitsPerSample < 4) throw new ForgeFormatError(`FLAC: bit depth ${stream.bitsPerSample} is invalid`);
  const chunks = Array.from({ length: stream.channels }, () => []);
  let decoded = 0;
  while (at + 2 <= bytes.length && bytes[at] === 255 && (bytes[at + 1] & 254) === 248) {
    if (stream.totalSamples > 0 && decoded >= stream.totalSamples) break;
    const { next, samples } = decodeFrame(bytes, at, stream);
    for (let c = 0; c < stream.channels; c++) chunks[c].push(samples[c]);
    decoded += samples[0].length;
    at = next;
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
  let at = order;
  for (let p = 0; p < partitions; p++) {
    const end = (p + 1) * per;
    const k = r.bits(paramBits);
    if (k === escape) {
      const raw = r.bits(5);
      for (; at < end; at++) out[at] = r.signed(raw);
    } else {
      const pow = 2 ** k;
      for (; at < end; at++) {
        const u = r.unary() * pow + r.bits(k);
        out[at] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
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
    if (cell.value === "-") {
      if (current) current.steps++;
      return;
    }
    if (cell.value === ".") {
      current = null;
      return;
    }
    const drum = DRUM_SYMBOLS[cell.value];
    if (channel.role === "drums") {
      if (!drum) throw new ForgeFormatError(`Unknown drum symbol: ${cell.value}`);
      current = { stepIndex: index, steps: 1, midi: null, drum, accent: cell.mod === ">", lane };
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
      ...channel.sample !== void 0 ? { sample: channel.sample } : {}
    });
  });
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
  const out = /* @__PURE__ */ new Set();
  for (const p of pitches) {
    for (let v = 1; v <= 127; v++) {
      for (let rr = 0; rr < m.zones.length; rr++) out.add(chooseZone(m, p, v, rr));
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
      files.set(i, await this.zoneBytes(m, i));
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
    return parseInstrumentManifest(await res.json());
  }
  async zoneBytes(m, index) {
    const zone = m.zones[index];
    const url = `${this.deps.baseUrl}${m.id}/${zone.file}`;
    const valid = async (d) => d.length === zone.bytes && await this.deps.sha256(d) === zone.sha256;
    const cached = await this.deps.cache.get(url);
    if (cached) {
      if (await valid(cached)) return cached;
      await this.deps.cache.delete(url);
    }
    const data = await this.download(m.id, zone.file, url);
    if (!await valid(data)) throw new Error(`instrument "${m.id}": ${zone.file} failed its checksum`);
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
  const open = () => opened ??= globalThis.caches.open(CACHE_NAME);
  const cache = {
    async get(url) {
      const hit = await (await open()).match(url);
      return hit ? new Uint8Array(await hit.arrayBuffer()) : void 0;
    },
    async put(url, data) {
      await (await open()).put(url, new Response(data));
    },
    async delete(url) {
      await (await open()).delete(url);
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
  const start = Math.min(len - 2, startMs / 1e3 * loaded.sampleRate);
  const at = (k) => {
    const i = k < 0 ? 0 : k >= len ? len - 1 : k;
    if (nc === 1) return chans[0][i];
    let s = 0;
    for (let c = 0; c < nc; c++) s += chans[c][i];
    return s / nc;
  };
  const interp = (pos2) => {
    const k = Math.floor(pos2);
    const x = pos2 - k;
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
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
  const relN = Math.max(edgeN, Math.round(m.release * outRate));
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
  return 60 / tempo * (4 / stepDenominator(time));
}
function stepSeconds(tune, channel) {
  return 60 / tune.tempo * (4 / stepDenominator(channel.step));
}
var ACCENT_GAIN = 1.25;
function applyChannelFx(mono, fx, tune, rate) {
  let signal = mono;
  const eq = fx?.eq;
  if (eq?.hp) filterInPlace(signal, new Biquad("highpass", eq.hp, rate));
  if (eq?.lp) filterInPlace(signal, new Biquad("lowpass", eq.lp, rate));
  if (eq?.low) filterInPlace(signal, new Biquad("lowshelf", 120, rate, 0.7071, eq.low));
  if (eq?.mid) filterInPlace(signal, new Biquad("peak", 1e3, rate, 0.9, eq.mid));
  if (eq?.high) filterInPlace(signal, new Biquad("highshelf", 8e3, rate, 0.7071, eq.high));
  if (fx?.comp) compress([signal], rate, { thresholdDb: fx.comp.threshold, ratio: fx.comp.ratio });
  let left = signal;
  let right = signal;
  if (fx?.chorus) {
    left = chorus(signal, rate, { mix: fx.chorus, phase: 0 });
    right = chorus(signal, rate, { mix: fx.chorus, phase: 0.5, rateHz: 0.7 });
  }
  if (fx?.delay) {
    const time = delaySeconds(fx.delay.time, tune.tempo);
    const wet = echo(signal, rate, { timeMs: time * 1e3, feedback: fx.delay.feedback });
    const mix = fx.delay.mix;
    left = left === signal ? signal.slice() : left;
    right = right === signal ? signal.slice() : right;
    for (let i = 0; i < signal.length; i++) {
      left[i] += wet[i] * mix * 0.7;
      right[i] += wet[i] * mix;
    }
  }
  return { left, right };
}
function studioLength(tune, options = {}) {
  const rate = options.sampleRate ?? 44100;
  const repeats = Math.max(1, Math.floor(options.repeats ?? 1));
  const body = Math.round(tuneSeconds(tune) * repeats * rate);
  const tailSeconds = options.tail ?? 3;
  return { body, total: body + Math.round(tailSeconds * rate) };
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
  for (let pass = 0; pass < repeats; pass++) {
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
  const { left, right } = applyChannelFx(scratch, channel.fx, tune, rate);
  const pan = Math.max(-1, Math.min(1, channel.pan));
  const angle = (pan + 1) * Math.PI / 4;
  const gl = Math.cos(angle) * Math.SQRT2;
  const gr = Math.sin(angle) * Math.SQRT2;
  const send = Math.max(0, Math.min(1, channel.fx?.reverb ?? 0));
  return { left, right, gainL: gl, gainR: gr, send };
}
function mixMaster(tune, channels, options = {}, gain = {}) {
  const rate = options.sampleRate ?? 44100;
  const { body: bodySamples, total: total2 } = studioLength(tune, options);
  const dryL = new Float32Array(total2);
  const dryR = new Float32Array(total2);
  const sendL = new Float32Array(total2);
  const sendR = new Float32Array(total2);
  for (const ch of channels) {
    const { send, gainL, gainR } = ch;
    for (let i = 0; i < total2; i++) {
      dryL[i] += ch.left[i] * gainL;
      dryR[i] += ch.right[i] * gainR;
      if (send > 0) {
        sendL[i] += ch.left[i] * gainL * send;
        sendR[i] += ch.right[i] * gainR * send;
      }
    }
  }
  const master = tune.master ?? {};
  const room = master.reverb;
  if (room && room.wet > 0) {
    const wet = reverb(sendL, sendR, rate, { room: room.room, damp: room.damp, preDelayMs: room.preDelayMs });
    for (let i = 0; i < total2; i++) {
      dryL[i] += wet.left[i] * room.wet;
      dryR[i] += wet.right[i] * room.wet;
    }
  }
  if (master.comp) compress([dryL, dryR], rate, { thresholdDb: master.comp.threshold, ratio: master.comp.ratio, attackMs: 20, releaseMs: 200 });
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
  return JSON.stringify({ channel, track: { name, tempo, meter, key, scale, bars, loop } });
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
