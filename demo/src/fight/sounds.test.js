import { describe, expect, it } from "vitest";
import { MOCK_EVENTS } from "./testFight.js";
import { cuesBetween, cuesFor, musicPlaysDuring, pickOther } from "./soundCues.js";
import { SFX, SONGS, SOUND_GROUPS, playStep } from "./sounds.js";

const votes = (label) => ({ ada: label, rook: label, nova: label });
const soundsOf = (event) => cuesFor(event).map((c) => c.sound);

/** A stand-in audio context. It can't judge how a sound is, only that the values are valid. */
function fakeContext() {
  const bad = [];
  const check = (v) => {
    if (!Number.isFinite(v)) bad.push(v);
  };
  const param = () => ({
    value: 0,
    setValueAtTime: (v, t) => [v, t].forEach(check),
    linearRampToValueAtTime: (v, t) => [v, t].forEach(check),
    exponentialRampToValueAtTime: (v, t) => {
      [v, t].forEach(check);
      if (v <= 0) bad.push(v);
    },
  });
  const node = (extra) => ({ connect: (d) => d, ...extra });
  const source = () => node({ frequency: param(), start: check, stop: check });
  return {
    bad,
    sampleRate: 48000,
    createOscillator: source,
    createBufferSource: source,
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ frequency: { value: 0 } }),
    createBuffer: (_c, n, r) => {
      const data = new Float32Array(n);
      return { sampleRate: r, getChannelData: () => data };
    },
  };
}

describe("sound library", () => {
  it("every effect in a group exists", () => {
    for (const ids of Object.values(SOUND_GROUPS)) for (const id of ids) expect(SFX[id]).toBeTypeOf("function");
  });

  it("every effect schedules valid audio", () => {
    for (const fn of Object.values(SFX)) {
      const ctx = fakeContext();
      fn(ctx, {}, 1);
      expect(ctx.bad).toEqual([]);
    }
  });

  it("every song has a full pattern and schedules valid audio", () => {
    for (const song of Object.values(SONGS)) {
      expect(song.lead).toHaveLength(64);
      expect(song.bass).toHaveLength(16);
      const ctx = fakeContext();
      for (let s = 0; s < 128; s++) playStep(ctx, {}, song, s, s * 0.1);
      expect(ctx.bad).toEqual([]);
    }
  });
});

describe("which sound plays when", () => {
  it("a challenge is an attack", () => {
    expect(soundsOf({ type: "challenge", text: "x" })).toEqual(["attack"]);
  });

  it("an upheld or partly upheld ruling lands as an attack", () => {
    expect(soundsOf({ type: "ruling", votes: votes("upheld") })).toEqual(["attack"]);
    expect(soundsOf({ type: "ruling", votes: votes("partially_upheld") })).toEqual(["attack"]);
  });

  it("a rejected ruling is a block", () => {
    expect(soundsOf({ type: "ruling", votes: votes("rejected") })).toEqual(["block"]);
  });

  it("a sealed round is points", () => {
    expect(soundsOf({ type: "round_sealed" })).toEqual(["points"]);
  });

  it("each round rings the bell and changes the song", () => {
    expect(cuesFor({ type: "round_start" })).toEqual([expect.objectContaining({ sound: "bell", newSong: true })]);
  });

  it("victory needs a winner", () => {
    expect(soundsOf({ type: "result", winner: "a" })).toEqual(["victory"]);
    expect(soundsOf({ type: "result" })).toEqual([]);
  });

  it("music rests at the result and during organizer review", () => {
    expect(musicPlaysDuring({ type: "pitch" })).toBe(true);
    expect(musicPlaysDuring({ type: "result" })).toBe(false);
    expect(musicPlaysDuring({ type: "human_review" })).toBe(false);
  });

  it("the sample fight uses attack, block, points, bell and victory", () => {
    const heard = new Set(MOCK_EVENTS.flatMap(soundsOf));
    expect([...heard].sort()).toEqual(["attack", "bell", "block", "points", "victory"]);
  });
});

describe("following the playback clock", () => {
  const events = [
    { type: "round_start", round: "product" }, // bell at 20 ms
    { type: "challenge", text: "x" }, // attack at 20 ms
    { type: "round_sealed", round: "product" }, // points at 140 ms
    { type: "result", winner: "a" }, // victory at 225 ms
  ];
  const sounds = (from, to) => cuesBetween(events, from, to).map((c) => c.sound);

  it("plays a cue once as the clock passes it", () => {
    expect(sounds({ index: 0, ms: 0 }, { index: 0, ms: 16 })).toEqual([]);
    expect(sounds({ index: 0, ms: 16 }, { index: 0, ms: 32 })).toEqual(["bell"]);
    expect(sounds({ index: 0, ms: 32 }, { index: 0, ms: 48 })).toEqual([]);
  });

  it("catches cues across the step into the next event", () => {
    expect(sounds({ index: 0, ms: 10 }, { index: 1, ms: 30 })).toEqual(["bell", "attack"]);
  });

  it("a seek doesn't play what it skipped", () => {
    expect(sounds({ index: 0, ms: 500 }, { index: 3, ms: 0 })).toEqual([]);
    expect(sounds({ index: 3, ms: 0 }, { index: 3, ms: 300 })).toEqual(["victory"]);
    expect(sounds({ index: 3, ms: 300 }, { index: 0, ms: 0 })).toEqual([]);
  });

  it("standing still plays nothing", () => {
    expect(sounds({ index: 1, ms: 30 }, { index: 1, ms: 30 })).toEqual([]);
  });
});

describe("random picks", () => {
  it("never repeats the previous sound", () => {
    for (let i = 0; i < 50; i++) expect(pickOther(["a", "b", "c"], "b")).not.toBe("b");
  });

  it("reaches every option", () => {
    const seen = new Set(Array.from({ length: 200 }, () => pickOther(["a", "b", "c"], null)));
    expect(seen.size).toBe(3);
  });

  it("a group of one still plays", () => {
    expect(pickOther(["bell"], "bell")).toBe("bell");
  });
});
