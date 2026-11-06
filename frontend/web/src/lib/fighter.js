/*
 * 8-bit fighter avatars. Pure functions: project -> traits -> pixel layers.
 *
 * Twelve distinct 16x20 silhouettes, selected stably from project identity:
 *  - costume trim  <- first sponsor track
 *  - gear (head / eye / hand slots) <- keywords in name, pitch and description
 *  - skin, hair colour, hair style  <- stable hash of the project id
 * Later, the agent service can return traits directly (PRD AGT-01); the
 * renderer only needs the traits object.
 *
 * Art colours live here and in fighterRoster.js: sprite palettes, not UI.
 */
import { FIGHTER_ROSTER, fighterStyle } from "./fighterRoster.js";

// ---------- palette ----------
const INK = "#17141f";
const SKINS = ["#f6d1b1", "#e8b48f", "#c68863", "#8d5a3b"];
const HAIRS = ["#3b2a20", "#6b3f26", "#d9a441", "#2f4bf0", "#ff5c93", "#1f8a5b", "#d8d4cf"];
const HAIR_STYLES = ["short", "spiky", "long"];
const TRACK_COLORS = {
  base: "#2f6bff",
  "the-graph": "#6f4cff",
  chainlink: "#375bd2",
  world: "#3d3a45",
  polygon: "#8247e5",
  filecoin: "#0090ff",
  uniswap: "#ff3d9a",
  ens: "#5298ff",
};
const NO_TRACK = "#5f5869";

const FIXED = {
  O: INK, // outline
  W: "#fffdf8", // eye white
  E: INK, // pupil
  M: "#c2185b", // mouth
  P: "#2e2938", // trousers
  B: "#8a4b2a", // boots
  A: "#ff5c93", // sweatband
  K: "#2f4bf0", // headphones
  G: "#2e2938", // goggle frame
  g: "#7cffb2", // goggle lens
  R: "#ff3b3b", // cyber eye
  C: "#4fd8ff", // circuit line
  D: INK, // shades
  Y: "#ffd43b", // coin
  y: "#fff4c7", // coin glint
};

export function shade(hex, f = 0.72) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** FNV-1a: small, stable, good enough to pick looks. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h;
}

// ---------- traits ----------
/** First matching rule per slot wins. Order inside a slot is priority. */
export const GEAR_RULES = [
  { slot: "head", id: "sweatband", label: "Sweatband", why: "health, fitness or wearables", re: /\b(health|fitness|workout|sleep|wearables?|whoop|gym|steps?|run(ning)?)\b/i },
  { slot: "head", id: "goggles", label: "VR goggles", why: "games, VR or 3D", re: /\b(games?|gaming|vr|ar|metaverse|3d|unity)\b/i },
  { slot: "head", id: "headphones", label: "Headphones", why: "music, audio or voice", re: /\b(music|audio|voice|podcasts?|sound|dj)\b/i },
  { slot: "eye", id: "cyber", label: "Cyber eye", why: "AI or agents", re: /\b(ai|agents?|llms?|gpt|autonomous|bots?)\b/i },
  { slot: "eye", id: "shades", label: "Shades", why: "privacy, ZK or security", re: /\b(privacy|private|zk|zero[- ]knowledge|security|confidential)\b/i },
  { slot: "hand", id: "coin", label: "Gold coin", why: "payments, staking or DeFi", re: /\b(usdc|stakes?|staking|defi|payments?|pays?|swaps?|yield|lending)\b/i },
];

export function fighterTraits(project) {
  const h = hash(project.seed || project.id || project.name);
  const text = [project.name, project.pitch, project.description].join(" ");
  const gear = {};
  for (const r of GEAR_RULES) {
    if (!gear[r.slot] && r.re.test(text)) gear[r.slot] = { id: r.id, label: r.label, why: r.why };
  }
  const track = project.tracks?.[0];
  const style = fighterStyle(project.archetype ?? project.fighter?.archetype) ?? FIGHTER_ROSTER[h % FIGHTER_ROSTER.length];
  return {
    seed: h,
    archetype: style.id,
    archetypeName: style.name,
    archetypeDetail: style.detail,
    skin: style.skin ?? SKINS[h % SKINS.length],
    hair: style.hair ?? HAIRS[(h >>> 3) % HAIRS.length],
    hairStyle: HAIR_STYLES[(h >>> 7) % HAIR_STYLES.length],
    jacket: TRACK_COLORS[track] ?? NO_TRACK,
    jacketFrom: track ?? null,
    gear,
  };
}

// ---------- pixels ----------
const HEADS = {
  short: ["....OOOOOOOO....", "...OHHHHHHHHO...", "..OHHHHHHHHHHO..", "..OHHhHHHHhHHO..", "..OHSSSSSSSSHO.."],
  spiky: ["...OHOOHOOHO....", "..OHHHHHHHHHHO..", "..OHHHHHHHHHHO..", ".OHHHhHHHHhHHHO.", "..OHSSSSSSSSHO.."],
  long: ["....OOOOOOOO....", "...OHHHHHHHHO...", "..OHHHHHHHHHHO..", ".OHHHhHHHHhHHHO.", ".OHHSSSSSSSSHHO."],
};
const FACE_AND_BODY = [
  "..OSSSSSSSSSSO..", // 5  (eyes drawn on their own layer)
  "..OSSSSSSSSSSO..", // 6
  "..OsSSSMMSSSsO..", // 7
  "...OsSSSSSSsO...", // 8
  "....OOOOOOOO....", // 9
  "...OJJJJJJJJO...", // 10
  "..OJJJJJJJJJJO..", // 11
  ".OJJOJJJJJJOJJO.", // 12
  ".OJJOJJJJJJOJJO.", // 13
  ".OSSOjjjjjjOSSO.", // 14
  ".OOO.OPPPPO.OOO.", // 15
  ".....OPPPPO.....", // 16
  ".....OPOOPO.....", // 17
  "....OBBOOBBO....", // 18
  "....OOOOOOOO....", // 19
];
const LONG_SIDES = [5, 6, 7, 8].flatMap((y) => [[1, y, "O"], [2, y, "H"], [13, y, "H"], [14, y, "O"]]);

const EYES_OPEN = [[5, 5, "W"], [6, 5, "E"], [5, 6, "W"], [6, 6, "E"], [9, 5, "W"], [10, 5, "E"], [9, 6, "W"], [10, 6, "E"]];
const EYES_CLOSED = [[5, 6, "E"], [6, 6, "E"], [9, 6, "E"], [10, 6, "E"]];

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const GEAR_PIXELS = {
  sweatband: [...range(3, 12).map((x) => [x, 3, "A"]), [13, 3, "A"], [14, 4, "A"], [14, 5, "A"]],
  goggles: [...range(3, 12).map((x) => [x, 5, "G"]), ...range(3, 12).map((x) => [x, 6, "G"]), ...[4, 5, 6, 9, 10, 11].map((x) => [x, 5, "g"]), ...[4, 5, 6, 9, 10, 11].map((x) => [x, 6, "g"])],
  headphones: [...range(4, 11).map((x) => [x, 0, "K"]), [3, 1, "K"], [12, 1, "K"], ...[4, 5, 6].flatMap((y) => [[1, y, "K"], [2, y, "K"], [13, y, "K"], [14, y, "K"]])],
  cyber: [[9, 5, "R"], [10, 5, "R"], [9, 6, "R"], [10, 6, "R"], [11, 6, "C"], [11, 7, "C"], [10, 8, "C"]],
  shades: [...range(3, 12).map((x) => [x, 5, "D"]), ...[4, 5, 6, 9, 10, 11].map((x) => [x, 6, "D"])],
  coin: [[13, 15, "Y"], [14, 15, "Y"], [13, 16, "Y"], [14, 16, "Y"]],
};
/** Pixels that twinkle on their own beat. */
const GLINTS = { coin: [[15, 14, "y"]], cyber: [[10, 5, "W"]] };

function colorFor(key, t) {
  switch (key) {
    case "H": return t.hair;
    case "h": return shade(t.hair, 0.78);
    case "S": return t.skin;
    case "s": return shade(t.skin, 0.85);
    case "J": return t.jacket;
    case "j": return shade(t.jacket);
    default: return fighterStyle(t.archetype)?.palette[key] ?? FIXED[key];
  }
}

/** Merge horizontal runs of one colour into single rects. */
function toRects(pixels, t) {
  const rows = new Map();
  for (const [x, y, k] of pixels) {
    if (!rows.has(y)) rows.set(y, new Map());
    rows.get(y).set(x, colorFor(k, t));
  }
  const rects = [];
  for (const [y, row] of rows) {
    const xs = [...row.keys()].sort((a, b) => a - b);
    let start = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      const prev = xs[i - 1];
      if (x !== prev + 1 || row.get(x) !== row.get(start)) {
        rects.push({ x: start, y, w: prev - start + 1, fill: row.get(start) });
        start = x;
      }
    }
  }
  return rects;
}

function gridPixels(rows, yOffset = 0) {
  const out = [];
  rows.forEach((row, y) => [...row].forEach((k, x) => k !== "." && out.push([x, y + yOffset, k])));
  return out;
}

function bodyPixels(t) {
  const style = fighterStyle(t.archetype);
  if (style) return gridPixels(style.rows);
  const base = [...gridPixels(HEADS[t.hairStyle]), ...gridPixels(FACE_AND_BODY, 5)];
  return t.hairStyle === "long" ? [...base, ...LONG_SIDES] : base;
}

function eyePixels(t, closed = false) {
  const style = fighterStyle(t.archetype);
  if (style?.fixedEyes || t.gear.head?.id === "goggles" || t.gear.eye?.id === "shades") return [];
  return (closed ? EYES_CLOSED : EYES_OPEN)
    .filter(([x, y]) => !(t.gear.eye?.id === "cyber" && x >= 9) && (closed || !style?.shortEyes || y === 5))
    .map(([x, y, k]) => [x, y + (style?.eyeOffset ?? 0) - (closed && style?.shortEyes ? 1 : 0), k]);
}

function gearPixels(t, id) {
  const offset = fighterStyle(t.archetype)?.eyeOffset ?? 0;
  return (GEAR_PIXELS[id] ?? []).map(([x, y, k]) => [x, y + (["cyber", "shades", "goggles"].includes(id) ? offset : 0), k]);
}

/**
 * Layers for the renderer:
 *  upper  - head, torso, hands, gear (bobs)
 *  legs   - stays planted
 *  eyesOpen / eyesClosed - swapped to blink
 *  glints - small twinkles
 */
export function fighterLayers(t) {
  const base = bodyPixels(t);
  const upper = base.filter(([, y]) => y <= 14);
  const legs = base.filter(([, y]) => y >= 15);
  const signature = fighterStyle(t.archetype)?.prop ?? [];
  const gear = [...signature, ...Object.values(t.gear).flatMap((g) => gearPixels(t, g.id))];
  const glints = Object.values(t.gear).flatMap((g) => (GLINTS[g.id] ?? [])
    .map(([x, y, k]) => [x, y + (g.id === "cyber" ? fighterStyle(t.archetype)?.eyeOffset ?? 0 : 0), k]));
  return {
    upper: toRects(upper, t),
    gear: toRects(gear, t),
    gearById: { signature: toRects(signature, t), ...Object.fromEntries(Object.values(t.gear).map((g) => [g.id, toRects(gearPixels(t, g.id), t)])) },
    legs: toRects(legs, t),
    eyesOpen: toRects(eyePixels(t), t),
    eyesClosed: toRects(eyePixels(t, true), t),
    glints: toRects(glints, t),
  };
}

// ---------- fight poses ----------
/*
 * The same chibi, posed for the fight player. Each pose is the base pixels
 * with an upper-body offset, a limb swap, or an eye swap: no new art set.
 * Poses draw into a 24×20 cell (body at x = 2) so the punching arm fits.
 * The fighter faces right; the renderer mirrors the right-hand corner.
 */
export const POSES = ["idle", "bob", "talk", "wind", "punch", "hit", "block", "victory", "defeat"];
export const POSE_CELL = { w: 24, h: 20, bodyX: 2 };

const ARM = (x0, y0, y1) => [
  ...range(y0, y1).flatMap((y) => [[x0 - 1, y, "O"], [x0, y, "J"], [x0 + 1, y, "j"], [x0 + 2, y, "O"]]),
  [x0, y0 - 1, "S"], [x0 + 1, y0 - 1, "S"], [x0, y0 - 2, "O"], [x0 + 1, y0 - 2, "O"], [x0 - 1, y0 - 1, "O"], [x0 + 2, y0 - 1, "O"],
];
const POSE_SPEC = {
  idle: {},
  bob: { uy: 1 },
  talk: { mouth: true },
  wind: { ux: -1 },
  punch: {
    ux: 1, dropFront: true,
    extra: [...range(12, 18).flatMap((x) => [[x, 11, "O"], [x, 14, "O"]]), ...range(12, 17).flatMap((x) => [[x, 12, "J"], [x, 13, "j"]]),
      [18, 12, "S"], [18, 13, "S"], [19, 12, "S"], [19, 13, "S"], [19, 11, "O"], [19, 14, "O"], [20, 12, "O"], [20, 13, "O"]],
  },
  hit: { ux: -1, closed: true },
  block: { ux: -1, dropFront: true, extra: ARM(12, 8, 12) },
  victory: { dropFront: true, dropBack: true, extra: [...ARM(1, 5, 11), ...ARM(13, 5, 11)] },
  defeat: { uy: 1, closed: true },
};

/** Rects for one pose, ready for an SVG renderer (same shape as fighterLayers). */
export function poseRects(t, pose = "idle") {
  const spec = POSE_SPEC[pose] ?? POSE_SPEC.idle;
  const base = bodyPixels(t);
  const ux = spec.ux ?? 0, uy = spec.uy ?? 0, bx = POSE_CELL.bodyX;
  const dropped = ([x, y]) => (spec.dropFront && y >= 12 && y <= 14 && x >= 12) || (spec.dropBack && y >= 12 && y <= 14 && x <= 3);
  const eyes = eyePixels(t, spec.closed);
  const gear = Object.values(t.gear).flatMap((g) => gearPixels(t, g.id)).filter(([, y]) => !(spec.dropFront && y >= 15));
  const propOffset = pose === "punch" ? [5, -2] : pose === "block" ? [-1, -4] : pose === "victory" ? [0, -6] : [0, 0];
  const props = (fighterStyle(t.archetype)?.prop ?? []).map(([x, y, k]) => [x + propOffset[0], y + propOffset[1], k]);
  // Remove the resting arm before adding its posed replacement.
  const upper = [...base.filter((p) => p[1] <= 14 && !dropped(p)), ...(spec.extra ?? []), ...eyes, ...gear.filter(([, y]) => y <= 14), ...props];
  const legs = [...base.filter(([, y]) => y >= 15), ...gear.filter(([, y]) => y >= 15)];
  const px = [
    ...legs.map(([x, y, k]) => [x + bx, y, k]),
    ...upper.map(([x, y, k]) => [x + bx + ux, y + uy, spec.mouth && k === "M" ? "E" : k]),
  ].filter(([x, y]) => x >= 0 && x < POSE_CELL.w && y >= 0 && y < POSE_CELL.h);
  return toRects(px, t);
}
