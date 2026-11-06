/*
 * Turns a frozen dossier into model context, and knows which evidence IDs are real.
 *
 * Evidence IDs are namespaced per corner so a fighter can cite its opponent's
 * evidence without collisions: "A:E3" is evidence E3 from the red corner's dossier.
 * Everything from the dossier is wrapped as untrusted data (PRD JDG-07).
 */

const SIDES = ["A", "B"];

const list = (items) => (items?.length ? items.map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x)}`).join("\n") : "- (none)");

/** Plain-text brief of one dossier. side: "A" | "B". */
function dossierBrief(dossier, side, projectName) {
  const ev = (dossier.evidence ?? [])
    .map((e) => `[${side}:${e.id}] (${e.status}${e.impact ? `, ${e.impact}` : ""}) ${e.claim}. Observed: ${e.observation ?? "-"}${e.limitations ? ` Limits: ${e.limitations}` : ""}`)
    .join("\n");
  const tests = dossier.tests
    ? `status=${dossier.tests.status}; claimed=${dossier.tests.claimed ?? "-"}; found=${JSON.stringify(dossier.tests.found ?? {})}; note=${dossier.tests.note ?? "-"}`
    : "no test data";
  const arch = (dossier.architecture ?? []).map((a) => `- ${a.component}: ${a.detail}`).join("\n");
  return [
    `PROJECT ${side}: ${projectName ?? "unnamed"} (frozen commit ${dossier.commit ?? "unknown"})`,
    `Summary: ${dossier.summary ?? "-"}`,
    `Problem: ${dossier.problem ?? "-"}`,
    `Intended users: ${dossier.intendedUsers ?? "-"}`,
    `Core journey:\n${list(dossier.coreJourney)}`,
    `Architecture:\n${arch || "- (none)"}`,
    `Tests: ${tests}`,
    `Reviewer strengths:\n${list(dossier.strengths)}`,
    `Reviewer limitations:\n${list(dossier.limitations)}`,
    `Risks:\n${list(dossier.risks)}`,
    `Unresolved questions:\n${list(dossier.unresolvedQuestions)}`,
    `Evidence (cite by ID in brackets):\n${ev || "(none)"}`,
  ].join("\n\n");
}

/** Wrap untrusted text so instructions inside it are treated as data. */
function untrusted(label, text) {
  return `<untrusted_data source="${label}">\n${text}\n</untrusted_data>`;
}

/**
 * Build the match context once per match.
 * corners: { A: { project, dossier }, B: { project, dossier } }
 * Returns { briefs: {A,B}, names: {A,B}, evidenceIds: Set, evidenceText: Map }
 */
function matchContext(corners) {
  const briefs = {};
  const names = {};
  const evidenceIds = new Set();
  const evidenceText = new Map();
  for (const side of SIDES) {
    const { project, dossier } = corners[side];
    names[side] = project?.name ?? project?.form?.project?.name ?? `Project ${side}`;
    briefs[side] = untrusted(`dossier-${side}`, dossierBrief(dossier, side, names[side]));
    for (const e of dossier.evidence ?? []) {
      const id = `${side}:${e.id}`;
      evidenceIds.add(id);
      evidenceText.set(id, `${e.claim}. ${e.observation ?? ""}`.trim());
    }
  }
  return { briefs, names, evidenceIds, evidenceText };
}

/** Transcript lines the models see. Only public match events: no odds, pools or stakes (JDG-06). */
function transcriptText(events, names) {
  if (!events?.length) return "(no exchanges yet)";
  const who = (actor) => (actor === "A" || actor === "B" ? `${names[actor]} [${actor}]` : actor);
  return untrusted(
    "match-transcript",
    events
      .map((e) => `#${e.seq ?? "?"} ${e.round ?? ""} ${e.type} by ${who(e.actor)}${e.challengeId ? ` (challenge ${e.challengeId})` : ""}: ${e.text}${e.evidenceIds?.length ? ` [cites ${e.evidenceIds.join(", ")}]` : ""}`)
      .join("\n"),
  );
}

module.exports = { SIDES, dossierBrief, untrusted, matchContext, transcriptText };
