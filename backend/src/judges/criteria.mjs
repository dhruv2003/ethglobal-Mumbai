/*
 * What judges score. Every judge scores every criterion 0-100 (PRD JDG-01).
 * A judge's priorities only decide how much each criterion counts in THAT
 * judge's overall score; the per-criterion scores stay comparable across
 * judges, so the fixed fight rubric (PRD 9.1) can still be computed from them.
 */
export const CRITERIA = [
  { id: "product_journey", label: "Product journey", about: "Is there a clear core journey that solves the stated problem end to end? Onboarding, flow, does the demo match the product." },
  { id: "real_world_value", label: "Real-world value", about: "Does it solve a real problem for real users? How big is the impact if it works?" },
  { id: "ui_ux", label: "UI / UX", about: "Clarity, polish, accessibility, works on phone and laptop." },
  { id: "code_quality", label: "Code quality", about: "Readable, well-structured code; sensible architecture; error handling; tests that mean something." },
  { id: "sdlc", label: "SDLC practices", about: "Commit history, tests and CI, docs, deploy process, honest scoping of what was built at the event." },
  { id: "feasibility", label: "Feasibility", about: "Can this actually ship and run? Dependencies, risks, what breaks first." },
  { id: "scalability", label: "Scalability", about: "Will it hold up with more users, data or chains? Where are the limits?" },
  { id: "business_model", label: "Business model", about: "Who pays, why, and is it sustainable? Public goods may explain sustainability without revenue." },
  { id: "brownie_points", label: "Brownie points", about: "Extra credit as this judge defines it (see their brownie points)." },
];

export const CRITERION_IDS = CRITERIA.map((c) => c.id);
export const TONES = ["strict", "balanced", "generous"];
