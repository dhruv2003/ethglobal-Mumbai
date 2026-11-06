/*
 * Arkiv schemas for everything the arena records. Arkiv is the arena's database:
 * `doc` holds every stored record (../db.mjs); the other types are the public,
 * queryable view of the same data. Files are on 0G Storage (../../zg/files.mjs).
 *
 * Every record shares the same base:
 *   projectId / projectName   which project it belongs to (fights use projectA/projectB)
 *   writtenAt                 when it was written (unix seconds); the newest one wins
 *   hash                      sha256 of the payload: an unchanged record is never rewritten
 *   part / parts              a payload over one entity's 128 KiB is split into parts
 *   enc, payload              the full record as gzip-compressed JSON
 *
 * The indexed columns are what people filter on; the full record is in the payload.
 * The panel and per-judge scorecards from a judging run are in ../arkiv.mjs.
 */
import { addr, bytes, dec, defineSchema, i32, str, u64 } from "@arkiv-network/sdk/schema";

const BASE = {
  projectId: str().indexed().optional(),
  projectName: str().indexed().optional(),
  writtenAt: u64().indexed(),
  hash: str().indexed(),
  part: i32().indexed(),
  parts: i32(),
  enc: str(),
  payload: bytes(),
};

/** A schema plus its column names (schemas are frozen), so readers can select every column. */
function record(type, columns) {
  const all = { ...BASE, ...columns };
  return { schema: defineSchema(`battle-arena.${type}`, all), columnNames: Object.keys(all) };
}

/** Each record type: its schema and the columns that identify one record (for "latest" and dedup). */
export const RECORDS = {
  // The arena's database (../db.mjs): one JSON document of a collection, e.g. events/eth-global.
  // payload is { id, value }; a deleted document gets a newer version with deleted = 1.
  doc: {
    ...record("doc", {
      collection: str().indexed(),
      docId: str().indexed(), // the id, or sha256 of it when it is over 128 bytes
      deleted: i32().indexed(),
    }),
    identity: ["collection", "docId"],
  },
  // The submission as entered: team, pitch, description, repo, demo link, tracks.
  project: {
    ...record("project", {
      teamName: str().indexed().optional(),
      kind: str().indexed(), // sample | submitted
      ownerWallet: addr().indexed().optional(),
      tracks: i32(),
    }),
    identity: ["projectId"],
  },
  // The review pipeline's steps and how each one ended.
  pipeline: {
    ...record("pipeline", {
      status: str().indexed(), // done | failed
      steps: i32(),
      failedSteps: i32(),
    }),
    identity: ["projectId"],
  },
  // The reviewer's evidence dossier (bug report): claims checked against the code, risks, tests.
  dossier: {
    ...record("dossier", {
      commit: str().indexed().optional(),
      claims: i32().indexed(),
      supported: i32(),
      contradicted: i32().indexed(),
      unverified: i32(),
    }),
    identity: ["projectId"],
  },
  // The demo video transcript the live test and the judges used.
  transcript: {
    ...record("transcript", {
      source: str().indexed(), // loom | openai | fixture ...
    }),
    identity: ["projectId"],
  },
  // The live-test report (steps, outcomes, failed requests). Recordings and screenshots are on Swarm.
  livetest: {
    ...record("livetest", {
      laptop: str().indexed().optional(), // passed | issues | failed | error
      phone: str().indexed().optional(),
      failedSteps: i32().indexed(),
      target: str().optional(),
    }),
    identity: ["projectId"],
  },
  // What the vision model saw on each live-test screenshot (judge context).
  vision: {
    ...record("vision", {
      model: str().indexed(),
      shots: i32(),
    }),
    identity: ["projectId"],
  },
  // A judging run in full: every judge's comment, per-criterion scores and reasoning,
  // headline, status, certainty. The panel/scorecard entities (../arkiv.mjs) hold only the numbers.
  review: {
    ...record("review", {
      runAt: u64().indexed(), // unix seconds of the run
      panelScore: dec().indexed().optional(),
      judges: i32(),
      scored: i32().indexed(),
      model: str().indexed(),
    }),
    identity: ["projectId"],
  },
  // Older records: a file kept on chain as raw bytes split into parts. New files go to
  // 0G Storage; this stays so earlier entities can still be read. hash = sha256 of the file.
  file: {
    ...record("file", {
      kind: str().indexed(), // demo-video | demo-screenshot | live-recording | live-screenshot
      name: str().indexed(), // e.g. "demo.mp4", "live/laptop/video.mp4", "live/phone/smoke-phone-f3.jpg"
      mime: str(),
      size: u64(), // file size in bytes ("bytes" is reserved by the query language)
    }),
    identity: ["projectId", "name"],
  },
  // A judge persona: who they are, weights, deal-breakers, the compiled system prompt.
  judge: {
    ...record("judge", {
      judgeId: str().indexed(),
      judgeName: str().indexed(),
      version: i32().indexed(),
      promptVersion: str().indexed(),
      tone: str(),
    }),
    identity: ["judgeId"],
  },
  // A tournament bracket: which project sits in which slot, and how matchmaking chose it.
  tournament: {
    ...record("tournament", {
      tournamentId: str().indexed(),
      title: str(),
      track: str().indexed(),
      size: i32(),
      bracketHash: str().indexed().optional(),
    }),
    identity: ["tournamentId"],
  },
  // A live 1v1 match: who fought, the final scores, the winner, and the full event stream.
  fight: {
    ...record("fight", {
      tournamentId: str().indexed(),
      match: i32().indexed(),
      projectA: str().indexed(),
      projectB: str().indexed(),
      projectAName: str().indexed(),
      projectBName: str().indexed(),
      winner: str().indexed(), // a | b | review | failed
      scoreA: dec().indexed().optional(),
      scoreB: dec().indexed().optional(),
      resultHash: str().indexed().optional(),
    }),
    identity: ["tournamentId", "match"],
  },
};

export const TYPES = Object.keys(RECORDS);
