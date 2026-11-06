/*
 * Every fight sound, generated with the Web Audio API: original 8-bit audio with
 * no files to load or license. Only builds audio nodes on the context it's given.
 */
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

function tone(ctx, out, t, { freq, to, dur, type = "square", vol = 0.2, attack = 0.002 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuffer = null;
function noise(ctx, out, t, { dur, vol = 0.2, filter = "highpass", cut = 4000 }) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Stepped noise, held for a few samples, gives the crunchy 8-bit texture.
    let held = 0;
    for (let i = 0; i < data.length; i++) {
      if (i % 4 === 0) held = Math.random() * 2 - 1;
      data[i] = held;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.frequency.value = cut;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bq).connect(gain).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const kick = (c, o, t, vol = 0.5) => tone(c, o, t, { freq: 150, to: 45, dur: 0.11, type: "triangle", vol });
const snare = (c, o, t, vol = 0.18) => {
  noise(c, o, t, { dur: 0.1, vol, cut: 1800 });
  tone(c, o, t, { freq: 220, to: 120, dur: 0.06, type: "square", vol: 0.05 });
};
const hat = (c, o, t, vol = 0.05) => noise(c, o, t, { dur: 0.03, vol, cut: 7500 });

export const SFX = {
  jab: (c, o, t) => {
    tone(c, o, t, { freq: 950, to: 260, dur: 0.09, vol: 0.2 });
    noise(c, o, t, { dur: 0.05, vol: 0.14, cut: 3000 });
  },
  heavy: (c, o, t) => {
    tone(c, o, t, { freq: 240, to: 48, dur: 0.26, type: "sawtooth", vol: 0.26 });
    noise(c, o, t, { dur: 0.16, vol: 0.28, filter: "lowpass", cut: 1400 });
    kick(c, o, t, 0.5);
  },
  zap: (c, o, t) => {
    tone(c, o, t, { freq: 1900, to: 130, dur: 0.22, vol: 0.16 });
    tone(c, o, t + 0.03, { freq: 1300, to: 90, dur: 0.2, vol: 0.09 });
  },
  clang: (c, o, t) => {
    tone(c, o, t, { freq: 1210, dur: 0.22, vol: 0.12 });
    tone(c, o, t, { freq: 1783, dur: 0.17, vol: 0.09 });
    noise(c, o, t, { dur: 0.05, vol: 0.2, cut: 5000 });
  },
  shield: (c, o, t) => {
    tone(c, o, t, { freq: 280, to: 780, dur: 0.14, type: "triangle", vol: 0.3 });
    tone(c, o, t + 0.1, { freq: 1180, dur: 0.08, vol: 0.08 });
  },
  thud: (c, o, t) => {
    tone(c, o, t, { freq: 150, to: 62, dur: 0.15, type: "triangle", vol: 0.45 });
    noise(c, o, t, { dur: 0.06, vol: 0.14, filter: "lowpass", cut: 900 });
  },
  coin: (c, o, t) => {
    tone(c, o, t, { freq: midi(86), dur: 0.07, vol: 0.14 });
    tone(c, o, t + 0.07, { freq: midi(93), dur: 0.26, vol: 0.14 });
  },
  arpeggio: (c, o, t) => {
    [72, 76, 79, 84, 88].forEach((n, i) => tone(c, o, t + i * 0.06, { freq: midi(n), dur: i === 4 ? 0.28 : 0.09, vol: 0.13 }));
  },
  tally: (c, o, t) => {
    for (let i = 0; i < 9; i++) tone(c, o, t + i * 0.04, { freq: midi(72 + i * 2), dur: 0.035, vol: 0.09 });
    tone(c, o, t + 0.38, { freq: midi(91), dur: 0.3, vol: 0.14 });
    tone(c, o, t + 0.38, { freq: midi(96), dur: 0.3, vol: 0.08 });
  },
  bell: (c, o, t) => {
    [0, 0.22].forEach((d) => {
      tone(c, o, t + d, { freq: 1046, dur: 0.34, vol: 0.14 });
      tone(c, o, t + d, { freq: 1568, dur: 0.24, vol: 0.07 });
      tone(c, o, t + d, { freq: 2793, dur: 0.12, vol: 0.03 });
    });
  },
  victory: (c, o, t) => {
    [[72, 0], [72, 0.11], [72, 0.22], [76, 0.33], [79, 0.55], [84, 0.77]].forEach(([n, d], i) => {
      tone(c, o, t + d, { freq: midi(n), dur: i === 5 ? 0.6 : 0.13, vol: 0.14 });
      tone(c, o, t + d, { freq: midi(n - 12), dur: i === 5 ? 0.6 : 0.13, type: "triangle", vol: 0.16 });
    });
  },
};

/** Each kind of moment and the sounds it picks from at random. */
export const SOUND_GROUPS = {
  attack: ["jab", "heavy", "zap"],
  block: ["clang", "shield", "thud"],
  points: ["coin", "arpeggio", "tally"],
  bell: ["bell"],
  victory: ["victory"],
};

export const SONGS = {
  neon: {
    bpm: 150,
    roots: [45, 41, 43, 40],
    lead: [
      69, 0, 72, 0, 76, 0, 72, 74, 76, 0, 79, 0, 76, 74, 72, 0,
      77, 0, 76, 0, 72, 0, 69, 0, 72, 0, 74, 76, 0, 74, 72, 0,
      71, 0, 74, 0, 79, 0, 74, 76, 79, 0, 81, 0, 79, 76, 74, 0,
      76, 0, 71, 0, 74, 0, 76, 79, 76, 0, 74, 0, 71, 0, 68, 0,
    ],
    bass: [0, null, 0, 12, null, 0, 12, null, 0, null, 0, 12, null, 0, 12, null],
    kicks: [0, 8],
    snares: [4, 12],
    hats: [0, 2, 4, 6, 8, 10, 12, 14],
  },
  cage: {
    bpm: 112,
    roots: [38, 38, 34, 33],
    lead: [
      62, 0, 0, 65, 0, 0, 69, 0, 68, 0, 0, 0, 65, 0, 62, 0,
      62, 0, 0, 65, 0, 0, 70, 0, 69, 0, 65, 0, 0, 0, 0, 0,
      58, 0, 0, 62, 0, 0, 65, 0, 70, 0, 0, 69, 0, 65, 0, 0,
      57, 0, 61, 0, 64, 0, 69, 0, 68, 0, 64, 0, 61, 0, 57, 0,
    ],
    bass: [0, null, null, 0, null, null, 0, null, 0, null, 12, null, 0, null, null, null],
    bassType: "sawtooth",
    kicks: [0, 3, 6, 8, 11, 14],
    snares: [4, 12],
    hats: [0, 4, 8, 12],
    leadVol: 0.07,
  },
  mumbai: {
    bpm: 128,
    roots: [48, 48, 53, 43],
    lead: [
      72, 0, 73, 0, 76, 0, 77, 79, 0, 77, 76, 0, 73, 0, 72, 0,
      76, 77, 79, 0, 80, 0, 79, 77, 76, 0, 77, 0, 76, 73, 72, 0,
      77, 0, 79, 80, 0, 83, 84, 0, 83, 80, 79, 0, 77, 76, 0, 0,
      79, 0, 76, 0, 73, 0, 76, 77, 76, 0, 73, 0, 72, 0, 0, 0,
    ],
    bass: [0, null, null, 0, null, 12, null, null, 0, null, 7, null, 0, null, 7, null],
    drumStyle: "hand",
    kicks: [0, 6, 10],
    snares: [3, 8, 12, 14],
    hats: [2, 5, 7, 11, 13, 15],
    leadType: "square",
  },
};

/** Schedules one 16th-note step of a song at time t. */
export function playStep(ctx, out, song, step, t) {
  const stepDur = 60 / song.bpm / 4;
  const inBar = step % 16;
  const bar = Math.floor(step / 16) % song.roots.length;
  const lead = song.lead[step % song.lead.length];
  if (lead) tone(ctx, out, t, { freq: midi(lead), dur: stepDur * 1.6, type: song.leadType ?? "square", vol: song.leadVol ?? 0.06 });
  const offset = song.bass[inBar];
  if (offset !== null) tone(ctx, out, t, { freq: midi(song.roots[bar] + offset), dur: stepDur * 0.9, type: song.bassType ?? "triangle", vol: song.bassType ? 0.1 : 0.22 });
  if (song.drumStyle === "hand") {
    // Hand-drum feel: a low bending hit and short high taps.
    if (song.kicks.includes(inBar)) tone(ctx, out, t, { freq: 190, to: 95, dur: 0.16, type: "triangle", vol: 0.34 });
    if (song.snares.includes(inBar)) {
      tone(ctx, out, t, { freq: 620, to: 520, dur: 0.05, type: "triangle", vol: 0.13 });
      noise(ctx, out, t, { dur: 0.02, vol: 0.05, cut: 3000 });
    }
    if (song.hats.includes(inBar)) hat(ctx, out, t, 0.035);
  } else {
    if (song.kicks.includes(inBar)) kick(ctx, out, t);
    if (song.snares.includes(inBar)) snare(ctx, out, t);
    if (song.hats.includes(inBar)) hat(ctx, out, t);
  }
}
