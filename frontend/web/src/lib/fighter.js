/*
 * 8-bit fighter avatars. Pure functions: project -> traits -> pixel layers.
 *
 * The base is a 16x20 chibi. Each project customises it from its own data:
 *  - jacket colour  <- first sponsor track
 *  - gear (head / eye / hand slots) <- keywords in name, pitch and description
 *  - skin, hair colour, hair style  <- stable hash of the project id
 * Later, the agent service can return traits directly (PRD AGT-01); the
 * renderer only needs the traits object.
 *
 * Art colours live here, not in tokens.css: they are sprite palette, not UI.
 */

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
  const h = hash(project.id || project.name);
  const text = [project.name, project.pitch, project.description].join(" ");
  const gear = {};
  for (const r of GEAR_RULES) {
    if (!gear[r.slot] && r.re.test(text)) gear[r.slot] = { id: r.id, label: r.label, why: r.why };
  }
  const track = project.tracks?.[0];
  return {
    seed: h,
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 3) % HAIRS.length],
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
    default: return FIXED[key];
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

/**
 * Layers for the renderer:
 *  upper  - head, torso, hands, gear (bobs)
 *  legs   - stays planted
 *  eyesOpen / eyesClosed - swapped to blink
 *  glints - small twinkles
 */
export function fighterLayers(t) {
  const base = [...gridPixels(HEADS[t.hairStyle]), ...gridPixels(FACE_AND_BODY, 5)];
  if (t.hairStyle === "long") base.push(...LONG_SIDES);
  const upper = base.filter(([, y]) => y <= 14);
  const legs = base.filter(([, y]) => y >= 15);
  const gear = Object.values(t.gear).flatMap((g) => GEAR_PIXELS[g.id] ?? []);
  const hidesEyes = t.gear.head?.id === "goggles" || t.gear.eye?.id === "shades";
  const cyber = t.gear.eye?.id === "cyber";
  const eyes = (set) => (hidesEyes ? [] : set.filter(([x]) => !(cyber && x >= 9)));
  const glints = Object.values(t.gear).flatMap((g) => GLINTS[g.id] ?? []);
  return {
    upper: toRects(upper, t),
    gear: toRects(gear, t),
    legs: toRects(legs, t),
    eyesOpen: toRects(eyes(EYES_OPEN), t),
    eyesClosed: toRects(eyes(EYES_CLOSED), t),
    glints: toRects(glints, t),
  };
}
