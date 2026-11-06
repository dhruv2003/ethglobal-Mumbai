import { describe, expect, test } from "vitest";
import { MOCK_EVENTS } from "./demoFight.js";
import { reelSlots } from "./usePlayback.js";

describe("reelSlots", () => {
  test("plays the whole fight in exactly 10 seconds", () => {
    const slots = reelSlots(MOCK_EVENTS);
    expect(Math.round(slots.reduce((s, x) => s + x.dur, 0))).toBe(10000);
  });
  test("starts on the intro, ends on the result, and keeps every ruling in order", () => {
    const slots = reelSlots(MOCK_EVENTS);
    expect(MOCK_EVENTS[slots[0].index].type).toBe("intro");
    expect(MOCK_EVENTS[slots.at(-1).index].type).toBe("result");
    const rulings = MOCK_EVENTS.filter((e) => e.type === "ruling").length;
    expect(slots.filter((s) => MOCK_EVENTS[s.index].type === "ruling")).toHaveLength(rulings);
    expect(slots.map((s) => s.index)).toEqual([...slots.map((s) => s.index)].sort((a, b) => a - b));
  });
});
