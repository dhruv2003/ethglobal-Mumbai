import { describe, expect, it } from "vitest";
import { fighterLayers, fighterTraits, poseRects, POSES } from "./fighter.js";
import { FIGHTER_ROSTER } from "./fighterRoster.js";

const base = { id: "x", name: "Plain", pitch: "A to-do list", description: "React app", tracks: [] };

describe("fighterTraits", () => {
  it("assigns a varied, stable cast across project identities", () => {
    const cast = Array.from({ length: 120 }, (_, i) => fighterTraits({ ...base, id: `mumbai-${i}` }).archetype);
    expect(new Set(cast).size).toBeGreaterThanOrEqual(12);
    expect(fighterTraits({ ...base, archetype: "babu-bhaiya" }).archetype).toBe("babu-bhaiya");
    expect(fighterTraits({ ...base, archetype: "unknown" }).archetype).toBe(fighterTraits(base).archetype);
  });

  it("is stable for the same project", () => {
    expect(fighterTraits(base)).toEqual(fighterTraits({ ...base }));
  });

  it("gives Go Health Me a sweatband, cyber eye and coin", () => {
    const t = fighterTraits({
      id: "go-health-me",
      name: "Go Health Me",
      pitch: "Put money on your own sleep or workouts. Your wearable proves it, SPOTTER pays the players who hit.",
      description: "SPOTTER, the settlement agent, pays the players. Stake test USDC.",
      tracks: ["world", "ens", "base"],
    });
    expect(t.gear.head.id).toBe("sweatband");
    expect(t.gear.eye.id).toBe("cyber");
    expect(t.gear.hand.id).toBe("coin");
    expect(t.jacketFrom).toBe("world");
  });

  it("keeps one item per slot, by rule priority", () => {
    const t = fighterTraits({ ...base, description: "a fitness game with music" });
    expect(t.gear.head.id).toBe("sweatband");
  });

  it("matches whole words only", () => {
    expect(fighterTraits({ ...base, description: "said again, maintain" }).gear.eye).toBeUndefined();
  });

  it("uses a neutral jacket with no tracks", () => {
    expect(fighterTraits(base).jacketFrom).toBeNull();
  });
});

describe("fighterLayers", () => {
  it("hides eyes behind goggles and shades", () => {
    const t = fighterTraits({ ...base, description: "a VR game about privacy" });
    expect(fighterLayers(t).eyesOpen).toEqual([]);
  });

  it("keeps the left eye blinking next to a cyber eye", () => {
    const t = fighterTraits({ ...base, description: "an AI agent" });
    const xs = fighterLayers(t).eyesOpen.map((r) => r.x);
    expect(Math.max(...xs)).toBeLessThan(9);
  });

  it("draws every rect inside the 16x20 sprite", () => {
    for (const d of ["", "AI agent payments", "VR game", "music", "privacy", "health"]) {
      const L = fighterLayers(fighterTraits({ ...base, id: d, description: d }));
      const { gearById, ...lists } = L;
      for (const r of [...Object.values(lists), ...Object.values(gearById)].flat()) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(16);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThan(20);
      }
    }
  });
});

describe("poseRects", () => {
  const t = fighterTraits({ id: "p", name: "Pose", pitch: "AI payments", description: "usdc agents", tracks: ["base"] });
  it.each(["idle", "bob", "talk", "wind", "punch", "hit", "block", "victory", "defeat"])("draws %s inside the 24×20 cell", (pose) => {
    const rects = poseRects(t, pose);
    expect(rects.length).toBeGreaterThan(20);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(24);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThan(20);
    }
  });
  it("extends the arm only when punching", () => {
    const reach = (pose) => Math.max(...poseRects(t, pose).map((r) => r.x + r.w));
    expect(reach("punch")).toBeGreaterThan(reach("idle") + 3);
  });
  it("keeps the extended fist filled after removing the resting arm", () => {
    const pixels = poseRects(t, "punch");
    expect(pixels.some((r) => r.y === 12 && r.x <= 22 && r.x + r.w > 22 && r.fill === t.skin)).toBe(true);
  });
});

describe("Mumbai roster", () => {
  it.each(FIGHTER_ROSTER.map((s) => [s.id]))("keeps %s and its accessories drawable in every pose", (archetype) => {
    for (const description of ["", "health AI payments", "VR privacy", "music agents"]) {
      const traits = fighterTraits({ ...base, archetype, description });
      const layers = fighterLayers(traits);
      for (const r of [layers.upper, layers.legs, layers.eyesOpen, layers.eyesClosed, ...Object.values(layers.gearById)].flat()) {
        expect(r.fill).toMatch(/^#[0-9a-f]{6}$/i);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(16);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThan(20);
      }
      for (const pose of POSES) {
        for (const r of poseRects(traits, pose)) {
          expect(r.fill).toMatch(/^#[0-9a-f]{6}$/i);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(24);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeLessThan(20);
        }
      }
    }
  });
  it("changes silhouettes, not just colours", () => {
    const silhouettes = FIGHTER_ROSTER.map(({ id }) => {
      const pixels = poseRects(fighterTraits({ ...base, archetype: id }));
      return pixels.flatMap((r) => Array.from({ length: r.w }, (_, i) => `${r.x + i},${r.y}`)).sort().join(";");
    });
    expect(new Set(silhouettes).size).toBeGreaterThanOrEqual(10);
  });
});
