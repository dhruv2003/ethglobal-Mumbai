import { hash } from "../lib/fighter.js";

export const MUMBAI_SCENES = [
  { id: "gateway", name: "Gateway of India", detail: "Apollo Bunder · golden hour", color: "#e7ae7e" },
  { id: "marine", name: "Marine Drive", detail: "Queen’s Necklace · after hours", color: "#8275ba" },
  { id: "sea-link", name: "Bandra–Worli Sea Link", detail: "Sea breeze · sunset showdown", color: "#70b8b7" },
  { id: "local", name: "CSMT & the local", detail: "Next stop · maximum Mumbai", color: "#b582ac" },
];

/** Stable through data refreshes; mock replays reuse ids across tournaments. */
export function sceneryIdentity(match) {
  const explicit = MUMBAI_SCENES.find((scene) => scene.id === match.scenery)?.id;
  return JSON.stringify([match.id, match.event, explicit, ...["a", "b"].map((side) => {
    const p = match.fighters?.[side] ?? {};
    return p.seed ?? p.id ?? p.name ?? side;
  })]);
}

export function sceneryForMatch(match) {
  const specified = MUMBAI_SCENES.find((scene) => scene.id === match.scenery);
  return specified ?? MUMBAI_SCENES[hash(sceneryIdentity(match)) % MUMBAI_SCENES.length];
}
