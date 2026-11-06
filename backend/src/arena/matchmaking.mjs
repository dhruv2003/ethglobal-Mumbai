/*
 * Who fights whom (PRD ORG-05). Builds the bracket with backend/matching:
 *   - round one pairs the most similar projects (exact best pairing, not greedy);
 *   - later rounds keep similar projects in opposite halves so they meet as late as possible;
 *   - same-team entries are never paired in round one.
 *
 * Similarity = 60% embeddings of the platform-generated dossier (never team-written text),
 * 20% shared tracks, 20% shared tech from the frozen repo analysis. Embeddings are computed
 * once per project and stored, so the same inputs always give the same bracket.
 * The bracket is audit-hashed; the result hash is what gets committed on chain at freeze.
 */
import crypto from "node:crypto";
import zg from "../zg/client.js";
import zgModels from "../zg/models.js";
import { buildBracket } from "../../matching/src/index.js";
import { db, dossiers, submissions } from "../store.mjs";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const EMBEDDING_MODEL = () => zgModels.MODELS.embed;

/** Only what the platform's reviewer wrote: intended users, problem, journey, architecture. */
export function embeddingText(dossier) {
  return [
    `Problem: ${dossier.problem ?? ""}`,
    `Intended users: ${dossier.intendedUsers ?? ""}`,
    `Summary: ${dossier.summary ?? ""}`,
    `Core journey: ${(dossier.coreJourney ?? []).join(" ")}`,
    `Architecture: ${(dossier.architecture ?? []).map((a) => `${a.component}: ${a.detail}`).join(" ")}`,
  ].join("\n");
}

/** Main libraries from the frozen repository analysis, as lowercase tags. */
export const techTags = (dossier) => [...new Set((dossier.dependencies ?? []).map((d) => String(d.name).toLowerCase().replace(/^@/, "").split("/")[0]))].slice(0, 12);

const defaultEmbed = async (texts) => (await zg.embed({ input: texts, model: EMBEDDING_MODEL() })).vectors;

/** Embeddings stored per project and model; recomputed only if the dossier text changed. */
async function embeddingsFor(items, embed) {
  const model = EMBEDDING_MODEL();
  // Arkiv documents (collection "embeddings"), one per project and model.
  const docId = (id) => `${id}:${model}`;
  const out = new Map();
  const missing = [];
  for (const it of items) {
    const hit = db.get("embeddings", docId(it.id));
    if (hit?.textHash === sha(it.text)) out.set(it.id, hit.vector);
    else missing.push(it);
  }
  if (missing.length) {
    const vectors = await embed(missing.map((m) => m.text));
    missing.forEach((m, i) => {
      db.put("embeddings", docId(m.id), { model, textHash: sha(m.text), vector: vectors[i] });
      out.set(m.id, vectors[i]);
    });
  }
  return out;
}

const teamKey = (s) => String(s.team?.name ?? "").trim().toLowerCase() || String(s.ownerWallet).toLowerCase();

/**
 * submissionIds: the field (2, 4, 8 or 16). Returns the bracket order and why each first-round fight exists.
 * opts.embed replaces the 0G embedding call (tests).
 */
export async function proposeBracket({ submissionIds, seed, blockedPairs = [], embed = defaultEmbed }) {
  const subs = submissionIds.map((id) => {
    const s = submissions.get(id);
    const d = dossiers.get(id);
    if (!s) throw Object.assign(new Error(`No such submitted project: ${id}`), { status: 400 });
    if (!d) throw Object.assign(new Error(`${s.project?.name} has no dossier yet, so it can't be matched.`), { status: 409 });
    return { s, d };
  });
  if (new Set(submissionIds).size !== submissionIds.length) throw Object.assign(new Error("A project can only appear once."), { status: 400 });
  const names = Object.fromEntries(subs.map(({ s }) => [s.id, s.project?.name ?? s.id]));
  let bracket;

  if (submissionIds.length === 2) {
    // One possible fight: nothing to choose, but the same rule still applies.
    const [x, y] = subs;
    if (teamKey(x.s) === teamKey(y.s)) throw Object.assign(new Error("Both projects are from the same team."), { status: 400 });
    const slots = [...submissionIds];
    const inputHash = sha(JSON.stringify({ seed, slots: [...slots].sort() }));
    bracket = { algorithmVersion: "single-pairing-v1", seed, embeddingModel: null, weights: null, blockedPairs: [], inputHash, resultHash: sha(JSON.stringify({ inputHash, slots })), slots, firstRound: [{ match: 0, a: slots[0], b: slots[1], similarity: null, parts: null }] };
  } else {
    const vectors = await embeddingsFor(subs.map(({ s, d }) => ({ id: s.id, text: embeddingText(d) })), embed);
    bracket = buildBracket({
      seed,
      embeddingModel: EMBEDDING_MODEL(),
      projects: subs.map(({ s, d }) => ({ id: s.id, teamId: teamKey(s), embedding: vectors.get(s.id), tracks: s.tracks ?? [], tech: techTags(d) })),
      blockedPairs,
    });
  }

  const proposal = { createdAt: new Date().toISOString(), submissionIds: [...submissionIds].sort(), bracket: JSON.parse(JSON.stringify(bracket)) };
  db.put("proposals", bracket.resultHash, proposal);
  return {
    ...proposal.bracket,
    names,
    explain: bracket.firstRound.map((m) => ({ match: m.match, a: m.a, b: m.b, aName: names[m.a], bName: names[m.b], similarityPct: m.similarity == null ? null : Math.round(m.similarity / 100), parts: m.parts })),
  };
}

/** A stored proposal, if its field is exactly this set of projects in this order. */
export function verifyProposal(resultHash, submissionIds) {
  if (!/^[0-9a-f]{64}$/.test(String(resultHash))) return null;
  const p = db.get("proposals", resultHash);
  return p && JSON.stringify(p.bracket.slots) === JSON.stringify(submissionIds) ? p.bracket : null;
}
