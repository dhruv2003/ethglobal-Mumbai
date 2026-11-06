/*
 * Fixed rubric and match constants (PRD 8.1, 9.1, 9.2). Agents and scoring read from here.
 */

const PROMPT_VERSION = "agents-v2";

/**
 * Order matters: rounds run in this order (BAT-04). Weights sum to 100.
 * asker: the judge who opens the round with the common question.
 * Keep in sync with backend/scoring/src/rubric.js and frontend/web/src/fight/score.js.
 */
const CRITERIA = [
  {
    id: "product",
    name: "Product usefulness and user journey",
    weight: 30,
    asker: "judge-product",
    guide:
      "Problem clarity, identifiable users, usefulness, coherence of the core journey, accessibility/usability evidence, and whether the demonstrated experience meets the claimed need. Polished visuals alone do not establish product value.",
  },
  {
    id: "ui",
    name: "User interface",
    weight: 10,
    asker: "judge-product",
    guide:
      "Judged mainly from the UI evidence ([A:U1], [B:U1]...), written by a vision model on 0G that looked at both projects' screenshots, demo-video frames and live-test screenshots side by side. Clarity of the main screens, visual hierarchy, readability, visible feedback and error states, phone and laptop layouts, and whether the screens in the demo match the live app. Visible defects (errors, broken or overlapping layout, empty screens) outweigh decoration. A landing or marketing page is not a working screen. A project with no UI images is unproven here, not failed: score it on what the dossier shows and mark high uncertainty.",
  },
  {
    id: "engineering",
    name: "Engineering and implementation",
    weight: 20,
    asker: "judge-engineering",
    guide:
      "Completeness, reproducibility, sound architecture, meaningful testing, dependency choices, and handling of important failure cases. Tests provide evidence rather than an automatic score.",
  },
  {
    id: "innovation",
    name: "Innovation and differentiation",
    weight: 20,
    asker: "judge-innovation",
    guide:
      "Distinct approach, meaningful improvement over obvious alternatives, and track relevance. Novelty claims require a stated basis and must not be inferred solely from branding.",
  },
  {
    id: "feasibility",
    name: "Feasibility and business model",
    weight: 10,
    asker: "judge-product",
    guide:
      "Practical delivery, operating assumptions, costs, adoption path, and appropriate sustainability or monetization. Open-source/public-good projects may explain sustainability without inventing revenue.",
  },
  {
    id: "defense",
    name: "Evidence-backed defense",
    weight: 10,
    asker: "judge-engineering",
    guide:
      "Accuracy, direct answers, justified rebuttals, acknowledgment of uncertainty, and consistency with the frozen submission. Charisma or aggression is not a substitute for correctness.",
  },
];
const CRITERION_IDS = CRITERIA.map((c) => c.id);
const criterion = (id) => CRITERIA.find((c) => c.id === id);

/** Word caps per turn (BAT-03, BAT-05, BAT-06, TIE-01). */
const WORD_LIMITS = {
  pitch: 60,
  question: 30,
  answer: 50,
  challenge: 40,
  rebuttal: 50,
  closing: 40,
  tiebreak_answer: 150,
  tiebreak_rebuttal: 100,
};

/** BAT-07 ruling labels. */
const RULINGS = ["upheld", "partially_upheld", "rejected", "inconclusive"];

/** AGT-06 structured claim types for advocate events. */
const CLAIM_TYPES = ["implemented_feature", "test_evidence", "user_value", "limitation_acknowledged", "future_plan", "challenge", "rebuttal", "clarification"];

/** JDG-01 default judges. Persona shapes questioning only, never weights. */
const DEFAULT_JUDGES = [
  {
    id: "judge-product",
    name: "The Product Judge",
    focus: "users, the core journey, usability and whether the product solves the stated problem",
    tone: "warm but exacting",
  },
  {
    id: "judge-engineering",
    name: "The Engineering Judge",
    focus: "architecture, code quality, tests, reproducibility and failure handling",
    tone: "dry and precise",
  },
  {
    id: "judge-innovation",
    name: "The Innovation Judge",
    focus: "novelty over obvious alternatives, feasibility, adoption path and sustainability",
    tone: "curious and skeptical",
  },
];

module.exports = { PROMPT_VERSION, CRITERIA, CRITERION_IDS, criterion, WORD_LIMITS, RULINGS, CLAIM_TYPES, DEFAULT_JUDGES };
