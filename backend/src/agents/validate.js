/*
 * Validators for agent output. Each returns a list of problems; empty means valid.
 * These feed chatJSON's one repair attempt (PRD JDG-05, AGT-06).
 */
const { RULINGS, CLAIM_TYPES } = require("./rubric");

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
const isStr = (s) => typeof s === "string" && s.trim().length > 0;

function checkEvidence(ids, allowed, path) {
  if (ids == null) return [];
  if (!Array.isArray(ids)) return [`${path} must be an array`];
  const bad = ids.filter((id) => !allowed.has(id));
  return bad.length ? [`${path} has unknown evidence IDs ${bad.join(", ")}; use only IDs shown in brackets like A:E1`] : [];
}

function fighter(o) {
  const p = [];
  for (const k of ["fighterName", "archetype", "speakingStyle", "catchphrase", "openingPitch", "advocacyBrief"]) if (!isStr(o?.[k])) p.push(`missing ${k}`);
  if (words(o?.openingPitch) > 60) p.push(`openingPitch is ${words(o.openingPitch)} words; max 60`);
  if (words(o?.catchphrase) > 8) p.push("catchphrase max 8 words");
  if (words(o?.fighterName) > 4) p.push("fighterName max 4 words");
  return p;
}

const question = (maxWords) => (o) => {
  const p = [];
  if (!isStr(o?.question)) p.push("missing question");
  else if (words(o.question) > maxWords) p.push(`question is ${words(o.question)} words; max ${maxWords}`);
  return p;
};

const turn = (maxWords, allowed, { needsTarget = false } = {}) => (o) => {
  const p = [];
  if (!isStr(o?.text)) p.push("missing text");
  else if (words(o.text) > maxWords) p.push(`text is ${words(o.text)} words; max ${maxWords}`);
  if (!CLAIM_TYPES.includes(o?.claimType)) p.push(`claimType must be one of ${CLAIM_TYPES.join(", ")}`);
  if (!Array.isArray(o?.evidenceIds)) p.push("evidenceIds must be an array (can be empty)");
  p.push(...checkEvidence(o?.evidenceIds, allowed, "evidenceIds"));
  if (needsTarget && !isStr(o?.targetClaim)) p.push("missing targetClaim (the opponent claim you are challenging)");
  return p;
};

/** Judge scorecard for one criterion, both corners, plus rulings on that round's challenges. */
const scorecard = (allowed, challengeIds) => (o) => {
  const p = [];
  for (const side of ["A", "B"]) {
    const s = o?.scores?.[side];
    if (!s) {
      p.push(`missing scores.${side}`);
      continue;
    }
    if (!Number.isInteger(s.score) || s.score < 0 || s.score > 100) p.push(`scores.${side}.score must be an integer 0-100`);
    if (!isStr(s.justification)) p.push(`missing scores.${side}.justification`);
    else if (words(s.justification) > 70) p.push(`scores.${side}.justification max 70 words`);
    if (!["low", "medium", "high"].includes(s.uncertainty)) p.push(`scores.${side}.uncertainty must be low|medium|high`);
    p.push(...checkEvidence(s.evidenceIds ?? [], allowed, `scores.${side}.evidenceIds`));
  }
  const rulings = o?.rulings ?? [];
  if (!Array.isArray(rulings)) p.push("rulings must be an array");
  else {
    const seen = new Set(rulings.map((r) => r?.challengeId));
    for (const id of challengeIds) if (!seen.has(id)) p.push(`missing ruling for challenge ${id}`);
    for (const r of rulings) {
      if (!challengeIds.includes(r?.challengeId)) p.push(`unknown challengeId ${r?.challengeId}`);
      if (!RULINGS.includes(r?.label)) p.push(`ruling label must be one of ${RULINGS.join(", ")}`);
      if (!isStr(r?.reason)) p.push(`ruling ${r?.challengeId} needs a reason`);
    }
  }
  return p;
};

function screenshot(o) {
  const p = [];
  if (!isStr(o?.screen)) p.push("missing screen");
  if (!Array.isArray(o?.observations)) p.push("observations must be an array");
  for (const ob of o?.observations ?? []) {
    if (!["strength", "issue", "bug", "info"].includes(ob?.kind)) p.push("observation.kind must be strength|issue|bug|info");
    if (!isStr(ob?.detail)) p.push("observation.detail missing");
    if (![1, 2, 3, 4, 5].includes(ob?.severity)) p.push("observation.severity must be 1-5");
  }
  return p;
}

function guidance(o) {
  const p = [];
  if (!isStr(o?.guidance)) p.push("missing guidance");
  else if (words(o.guidance) > 80) p.push("guidance max 80 words");
  if (!Array.isArray(o?.rejected)) p.push("rejected must be an array (can be empty)");
  return p;
}

module.exports = { words, fighter, question, turn, scorecard, screenshot, guidance };
