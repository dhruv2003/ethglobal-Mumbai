/*
 * Local data -> Arkiv record: { type, attrs, payload } for each record type.
 * Pure functions (no I/O), so they are easy to test. A builder returns null when
 * there is nothing to record yet.
 */
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { clip128, hundredthsToDec } from "../arkiv.mjs";

const who = (projectId, projectName) => ({ projectId: clip128(projectId), ...(projectName ? { projectName: clip128(projectName) } : {}) });
const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** project: what the team submitted (signature material is never published). */
export function projectRecord(project, rawSubmission = null) {
  if (!project) return null;
  const s = project.submission ?? {};
  const owner = rawSubmission?.ownerWallet;
  const { auth, ...submission } = rawSubmission ?? {};
  return {
    type: "project",
    attrs: {
      ...who(project.id, s.name),
      ...(s.teamName ? { teamName: clip128(s.teamName) } : {}),
      kind: project.kind,
      ...(isAddress(owner) ? { ownerWallet: addr(owner.toLowerCase()) } : {}),
      tracks: (s.tracks ?? []).length,
    },
    payload: { ...s, kind: project.kind, ...(rawSubmission ? { submittedAt: submission.submittedAt, ownerWallet: owner ?? null, rewardWallet: submission.rewardWallet ?? owner ?? null } : {}) },
  };
}

/** pipeline: only once it has finished. */
export function pipelineRecord(project, state) {
  if (!state?.finishedAt) return null;
  const failed = state.steps.filter((x) => x.status === "failed").length;
  return {
    type: "pipeline",
    attrs: { ...who(project.id, project.submission?.name), status: failed ? "failed" : "done", steps: state.steps.length, failedSteps: failed },
    payload: state,
  };
}

/** dossier: the reviewer's evidence report (bug report). */
export function dossierRecord(project, dossier = project?.dossier) {
  if (!dossier) return null;
  const ev = dossier.evidence ?? [];
  const count = (st) => ev.filter((e) => e.status === st).length;
  return {
    type: "dossier",
    attrs: {
      ...who(project.id, project.submission?.name),
      ...(dossier.commit ? { commit: clip128(dossier.commit) } : {}),
      claims: ev.length,
      supported: count("supported_by_code") + count("observed_in_test"),
      contradicted: count("contradicted"),
      unverified: count("unverified"),
    },
    payload: dossier,
  };
}

/** transcript: the demo video transcript ({ source, ... }). */
export function transcriptRecord(project, transcript) {
  if (!transcript) return null;
  return { type: "transcript", attrs: { ...who(project.id, project.submission?.name), source: clip128(transcript.source ?? "unknown") }, payload: transcript };
}

/** livetest: smoke.json (media paths only; the files themselves are on Swarm). */
export function livetestRecord(project, smoke = project?.liveTest) {
  if (!smoke?.runs?.length) return null;
  const outcome = (d) => smoke.runs.find((r) => r.device === d)?.outcome?.status;
  const failed = smoke.runs.reduce((n, r) => n + (r.phases ?? []).reduce((k, ph) => k + ph.steps.filter((x) => x.status === "failed").length, 0), 0);
  return {
    type: "livetest",
    attrs: {
      ...who(project.id, project.submission?.name),
      ...(outcome("laptop") ? { laptop: outcome("laptop") } : {}),
      ...(outcome("phone") ? { phone: outcome("phone") } : {}),
      failedSteps: failed,
      ...(smoke.target ? { target: clip128(smoke.target) } : {}),
    },
    payload: smoke,
  };
}

/** vision: screenshot observations the judges read (data/evidence/<id>.json). */
export function visionRecord(project, cache) {
  if (!cache?.records?.length) return null;
  return { type: "vision", attrs: { ...who(project.id, project.submission?.name), model: clip128(cache.model ?? "unknown"), shots: cache.records.length }, payload: cache };
}

/** judge: one persona. */
export function judgeRecord(p) {
  return {
    type: "judge",
    attrs: { judgeId: clip128(p.id), judgeName: clip128(p.name), version: p.version, promptVersion: clip128(p.promptVersion), tone: clip128(p.tone) },
    payload: p,
  };
}

/** tournament: the registered bracket. */
export function tournamentRecord(t) {
  if (!t) return null;
  return {
    type: "tournament",
    attrs: {
      tournamentId: clip128(t.id),
      title: clip128(t.title),
      track: clip128(t.track),
      size: t.projects.length,
      ...(t.matching?.resultHash ? { bracketHash: clip128(t.matching.resultHash) } : {}),
    },
    payload: t,
  };
}

/** fight: one recorded 1v1 match. Needs the tournament to name the two projects. */
export function fightRecord(f, tournament) {
  if (!f || !tournament) return null;
  const side = (i) => tournament.projects.find((p) => p.index === i);
  const a = side(f.a);
  const b = side(f.b);
  if (!a || !b) return null;
  const winner = f.error ? "failed" : f.needsReview ? "review" : (f.events ?? []).findLast?.((e) => e.type === "result")?.winner ?? "unknown";
  return {
    type: "fight",
    attrs: {
      tournamentId: clip128(f.tournamentId),
      match: f.match,
      projectA: clip128(a.submissionId),
      projectB: clip128(b.submissionId),
      projectAName: clip128(a.name),
      projectBName: clip128(b.name),
      winner,
      ...(Number.isInteger(f.scores?.a) ? { scoreA: dec(hundredthsToDec(f.scores.a)) } : {}),
      ...(Number.isInteger(f.scores?.b) ? { scoreB: dec(hundredthsToDec(f.scores.b)) } : {}),
      ...(f.resultHash ? { resultHash: clip128(f.resultHash) } : {}),
    },
    payload: f,
  };
}

/**
 * review: a judging run in full (data/reviews/<id>.json): each judge's comment,
 * per-criterion scores and reasoning, headline, status. Panel/scorecards hold only numbers.
 */
export function reviewRecord(project, result) {
  if (!result?.reviews?.length) return null;
  const scored = result.reviews.filter((r) => r.status === "scored").length;
  return {
    type: "review",
    attrs: {
      ...who(project.id, project.submission?.name),
      runAt: u64(BigInt(Math.floor(new Date(result.ranAt ?? Date.now()).getTime() / 1000))),
      ...(Number.isInteger(result.panelHundredths) ? { panelScore: dec(hundredthsToDec(result.panelHundredths)) } : {}),
      judges: result.reviews.length,
      scored,
      model: clip128(result.model ?? "unknown"),
    },
    payload: result,
  };
}

export const FILE_KINDS = ["demo-video", "demo-screenshot", "live-recording", "live-screenshot"];
const MIMES = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const mimeOf = (name) => MIMES[String(name).split(".").pop().toLowerCase()] ?? "application/octet-stream";

/** file: one file's columns (the bytes are written with writeBlob). file = { kind, name, size, buffer? } */
export function fileRecord(project, file) {
  if (!file || !FILE_KINDS.includes(file.kind)) return null;
  return {
    type: "file",
    attrs: { ...who(project.id, project.submission?.name), kind: file.kind, name: clip128(file.name), mime: mimeOf(file.name), size: u64(BigInt(file.size ?? file.buffer?.length ?? 0)) },
    payload: file.buffer ?? null,
  };
}
