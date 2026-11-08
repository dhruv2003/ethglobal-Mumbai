import { describe, expect, it } from "vitest";
import { catchUp, foldEvents, initialFightState, reduceFight, scoreSoFar, stateAt } from "./reducer.js";
import { fmtHealth, fmtScore, healthThousandths, pointsKept, rulingLabel, scoreHundredths } from "./score.js";
import { MOCK_EVENTS } from "./testFight.js";
import { choreograph, eventDuration } from "./choreo.js";

const sealProduct = { seq: 1, type: "round_sealed", round: "product", scores: { a: [72, 70, 74], b: [64, 66, 61] } };

describe("score.js (PRD 8.2 / 9.2)", () => {
  it("starts at 100.000 health before any seal", () => {
    expect(healthThousandths({})).toBe(100000);
  });

  it("matches the worked numbers for a sealed product round", () => {
    const a = { product: [72, 70, 74] };
    const b = { product: [64, 66, 61] };
    expect(pointsKept(a)).toBe(27480);
    expect(fmtScore(scoreHundredths(pointsKept(a)))).toBe("91.60");
    expect(healthThousandths(a)).toBe(93280);
    expect(healthThousandths(b)).toBe(91280);
    expect(fmtHealth(88376)).toBe("88.38"); // half-up from thousandths
  });

  it("floors health at 20 even with all zeros", () => {
    const zeros = Object.fromEntries(["product", "ui", "engineering", "innovation", "feasibility", "defense"].map((c) => [c, [0, 0, 0]]));
    expect(healthThousandths(zeros)).toBe(20000);
  });

  it("gives final_health = 20 + 0.8 × final_score, and equal scores equal health", () => {
    const s = { product: [81, 77, 90], engineering: [60, 70, 65], innovation: [55, 90, 72], feasibility: [88, 40, 61], defense: [70, 70, 71] };
    const score = scoreHundredths(pointsKept(s));
    expect(healthThousandths(s)).toBe(20000 + 8 * score);
    const same = { product: [77, 81, 90], engineering: [70, 60, 65], innovation: [90, 55, 72], feasibility: [40, 88, 61], defense: [71, 70, 70] };
    expect(healthThousandths(same)).toBe(healthThousandths(s));
  });

  it("labels a ruling by majority, else mixed", () => {
    expect(rulingLabel(["upheld", "upheld", "partially_upheld"])).toBe("upheld");
    expect(rulingLabel(["upheld", "rejected", "inconclusive"])).toBe("mixed");
  });
});

describe("reduceFight", () => {
  it("only changes health when a round is sealed", () => {
    let s = initialFightState();
    s = reduceFight(s, { seq: 1, type: "challenge", round: "product", actor: "a", target: "b", challengeId: "c1", text: "x" });
    s = reduceFight(s, { seq: 2, type: "ruling", round: "product", challengeId: "c1", votes: { ada: "upheld", rook: "upheld", nova: "upheld" } });
    s = reduceFight(s, { seq: 3, type: "penalty", round: "product", target: "b", judge: "ada", reason: "y" });
    expect(s.health).toEqual({ a: 100000, b: 100000 });
    expect(s.rulings[0]).toMatchObject({ label: "upheld", attacker: "a", target: "b" });
    s = reduceFight(s, { ...sealProduct, seq: 4 });
    expect(s.health).toEqual({ a: 93280, b: 91280 });
    expect(s.damage).toEqual({ round: "product", a: 6720, b: 8720 });
  });

  it("ignores duplicate and stale events (no double damage)", () => {
    const once = foldEvents([sealProduct]);
    const twice = foldEvents([sealProduct, sealProduct, { ...sealProduct }]);
    expect(twice.health).toEqual(once.health);
    expect(reduceFight(once, { ...sealProduct, seq: 0 })).toBe(once);
  });

  it("never lets a later event rewrite a sealed round", () => {
    const s = foldEvents([sealProduct, { seq: 2, type: "round_sealed", round: "product", scores: { a: [0, 0, 0], b: [100, 100, 100] } }]);
    expect(s.health).toEqual({ a: 93280, b: 91280 });
  });

  it("derives the label from votes when the event omits it", () => {
    const s = foldEvents([
      { seq: 1, type: "challenge", actor: "b", target: "a", challengeId: "c", round: "innovation" },
      { seq: 2, type: "ruling", challengeId: "c", votes: { ada: "partially_upheld", rook: "upheld", nova: "rejected" } },
    ]);
    expect(s.rulings[0].label).toBe("mixed");
  });

  it("holds the winner while human review is pending", () => {
    let s = foldEvents([{ seq: 1, type: "human_review", status: "pending" }, { seq: 2, type: "result", winner: "a", reason: "organizer" }]);
    expect(s.result).toBeNull();
    s = foldEvents([{ seq: 3, type: "human_review", status: "decided", winner: "b", rationale: "Stronger product evidence." }, { seq: 4, type: "result", winner: "b", reason: "organizer" }], s);
    expect(s.result).toEqual({ winner: "b", reason: "organizer" });
  });
});

describe("the mock match", () => {
  const final = foldEvents(MOCK_EVENTS);

  it("has strictly increasing sequence numbers", () => {
    MOCK_EVENTS.forEach((e, i) => expect(e.seq).toBe(i + 1));
  });

  it("ends with the higher score winning and health = 20 + 0.8 × score", () => {
    expect(final.result).toEqual({ winner: "a", reason: "score" });
    expect(fmtScore(scoreSoFar(final, "a"))).toBe("72.87");
    expect(fmtScore(scoreSoFar(final, "b"))).toBe("67.20");
    expect(fmtHealth(final.health.a)).toBe("78.30");
    expect(fmtHealth(final.health.b)).toBe("73.76");
    expect(final.health.a).toBeGreaterThan(final.health.b);
  });

  it("replays from any point to the same result (seek)", () => {
    const mid = MOCK_EVENTS[30].seq;
    expect(foldEvents(MOCK_EVENTS.filter((e) => e.seq > mid), stateAt(MOCK_EVENTS, mid))).toEqual(final);
  });

  it("reconnects from a snapshot plus overlapping catch-up without double damage", () => {
    const snapshot = stateAt(MOCK_EVENTS, 20);
    const missed = MOCK_EVENTS.filter((e) => e.seq > 14); // overlaps 15..20
    expect(catchUp(snapshot, missed)).toEqual(final);
  });
});

describe("choreograph", () => {
  const challengeIdx = MOCK_EVENTS.findIndex((e) => e.type === "ruling" && e.challengeId === "r2a");
  const ruling = MOCK_EVENTS[challengeIdx];
  const state = stateAt(MOCK_EVENTS, ruling.seq);

  it("lands an upheld hit: attacker punches, target takes the hit", () => {
    const c = choreograph(ruling, eventDuration(ruling) * 0.3, state);
    expect(c.a.pose).toBe("punch");
    expect(c.b.pose).toBe("hit");
    expect(c.fx.kind).toBe("hit");
  });

  it("shows a block for a rejected challenge", () => {
    const r = MOCK_EVENTS.find((e) => e.type === "ruling" && e.challengeId === "r2b");
    const c = choreograph(r, eventDuration(r) * 0.3, stateAt(MOCK_EVENTS, r.seq));
    expect(c.b.pose).toBe("punch");
    expect(c.a.pose).toBe("block");
    expect(c.fx.kind).toBe("block");
  });

  it("returns home at the end of a move and holds still under reduced motion", () => {
    const end = choreograph(ruling, eventDuration(ruling), state);
    expect(end.a.x).toBeCloseTo(28);
    expect(end.b.x).toBeCloseTo(56);
    expect(choreograph(ruling, 0, state, { reduced: true })).toEqual(choreograph(ruling, 99999, state, { reduced: true }));
  });
});
