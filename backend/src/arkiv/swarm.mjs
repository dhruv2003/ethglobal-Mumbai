/*
 * Swarm: the files people open from a judged project (the panel's full review,
 * the dossier, the live-test report, recordings and screenshots) go up as one
 * Swarm collection. Arkiv holds only the collection's reference (arkiv.mjs).
 *
 *   BEE_URL          a Bee node that can upload (not ultra-light), e.g. http://localhost:1633
 *   SWARM_BATCH_ID   the postage stamp batch to upload with (buy one on that node)
 *   SWARM_GATEWAY    where readers download from (default the public gateway)
 *
 * Uploads are NOT encrypted on purpose: this is public evidence, and an encrypted
 * reference carries its key, so it must never go into a public Arkiv entity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GATEWAY = (process.env.SWARM_GATEWAY || "https://api.gateway.ethswarm.org").replace(/\/$/, "");
export const swarmConfigured = () => Boolean(process.env.BEE_URL && process.env.SWARM_BATCH_ID);

/** Public link to one file of a collection. */
export const gatewayUrl = (reference, file = "") => `${GATEWAY}/bzz/${reference}/${file}`;

let beeClient;
async function bee(url = process.env.BEE_URL) {
  const { Bee } = await import("@ethersphere/bee-js");
  if (url !== process.env.BEE_URL) return new Bee(url);
  beeClient ??= new Bee(url);
  return beeClient;
}

/**
 * Put the bundle in a temp folder with the paths readers will use:
 *   review.json, dossier.json?, live/smoke.json, live/<device>/...
 * liveTest is the report; files are its media as [path like "laptop/video.mp4", bytes].
 * Returns { dir, files }. The caller removes dir.
 */
export function stageBundle({ result, dossier, liveTest = null, files: media = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-swarm-"));
  const files = [];
  const put = (rel, data) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    files.push(rel);
  };
  put("review.json", JSON.stringify(result, null, 2));
  if (dossier) put("dossier.json", JSON.stringify(dossier, null, 2));
  if (liveTest) {
    put("live/smoke.json", JSON.stringify(liveTest, null, 2));
    for (const [rel, bytes] of media) if (/^(laptop|phone)\/(video\.mp4|smoke-(laptop|phone)-[a-z0-9]+\.jpg)$/.test(rel)) put(`live/${rel}`, bytes);
  }
  return { dir, files };
}

/** Upload the bundle as one collection. Returns { reference, files }. */
export async function uploadBundle(input, { client } = {}) {
  if (!swarmConfigured()) throw new Error("Swarm is not set up: set BEE_URL and SWARM_BATCH_ID in backend/.env.");
  const { dir, files } = stageBundle(input);
  try {
    const b = client ?? (await bee());
    const { reference } = await b.collection.uploadFromDirectory(process.env.SWARM_BATCH_ID, dir);
    return { reference: typeof reference === "string" ? reference : reference.toHex(), files };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Read one file of a bundle back (default through the public gateway). Returns its text. */
export async function readFile(reference, file = "review.json", { client, url = GATEWAY } = {}) {
  const b = client ?? (await bee(url));
  const data = await b.file.download(reference, file);
  return data.data.toUtf8();
}
