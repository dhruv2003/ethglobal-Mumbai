/*
 * Score and health, exactly as PRD 8.2 (BAT-08) and 9.2 define them.
 * Integer fixed point only: health is stored in thousandths, scores in
 * hundredths. Health is ALWAYS derived from sealed judge scores; nothing
 * else (animation, rulings, stakes) can move it.
 */

export const CRITERIA = ["product", "engineering", "innovation", "feasibility", "defense"];
export const WEIGHTS = { product: 40, engineering: 20, innovation: 20, feasibility: 10, defense: 10 };
export const CRITERION_LABEL = {
  product: "Product",
  engineering: "Engineering",
  innovation: "Innovation",
  feasibility: "Feasibility",
  defense: "Defense",
};

/** sealed: { [criterion]: [judge1, judge2, judge3] } integer scores 0..100 */
export function pointsKept(sealed) {
  let kept = 30000;
  for (const [criterion, scores] of Object.entries(sealed)) {
    const w = WEIGHTS[criterion];
    if (!w) throw new Error(`Unknown criterion: ${criterion}`);
    for (const s of scores) kept -= w * (100 - s);
  }
  return kept;
}

/** Score so far, in hundredths: floor((2 × points_kept + 3) / 6). */
export const scoreHundredths = (kept) => Math.floor((2 * kept + 3) / 6);

/** Health in thousandths: 20000 + 8 × score_in_hundredths. Floor 20.000, max 100.000. */
export const healthThousandths = (sealed) => 20000 + 8 * scoreHundredths(pointsKept(sealed));

/** Display two decimals, rounding half up from thousandths (BAT-11). */
export function fmtHealth(thousandths) {
  const hundredths = Math.floor((thousandths + 5) / 10);
  return (hundredths / 100).toFixed(2);
}

export const fmtScore = (hundredths) => (hundredths / 100).toFixed(2);

/** Majority of three judge classifications, else "mixed" (BAT-07). */
export function rulingLabel(votes) {
  const counts = {};
  for (const v of votes) counts[v] = (counts[v] ?? 0) + 1;
  const top = Object.entries(counts).find(([, n]) => n >= 2);
  return top ? top[0] : "mixed";
}

export const RULING_TEXT = {
  upheld: "Upheld",
  partially_upheld: "Partially upheld",
  rejected: "Rejected",
  inconclusive: "Inconclusive",
  mixed: "Mixed ruling",
};

/** What the ring shows for a ruling (BAT-09): words first, never colour alone. */
export const RULING_OUTCOME = {
  upheld: "hit",
  partially_upheld: "graze",
  rejected: "block",
  inconclusive: "clash",
  mixed: "clash",
};
