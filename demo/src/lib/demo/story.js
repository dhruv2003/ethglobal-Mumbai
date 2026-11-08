/*
 * DEMO: the headline matchup, summarised from the same records every page reads
 * (src/data), so the landing page's numbers always match the project pages and the fight.
 */
import submissions from "@data/submissions.json";
import dossiers from "@data/dossiers.json";
import reviews from "@data/reviews.json";
import live from "@data/live.json";
import tournament from "@data/tournament.json";

const steps = (id, device) => (live[id]?.runs.find((r) => r.device === device)?.phases ?? []).flatMap((p) => p.steps);

export function tape(id) {
  const s = submissions.find((x) => x.id === id);
  const ev = dossiers[id]?.evidence ?? [];
  const n = (st) => ev.filter((e) => e.status === st).length;
  const laptop = steps(id, "laptop");
  const android = steps(id, "android");
  const ios = steps(id, "ios");
  const pass = (xs) => xs.filter((x) => x.status === "passed").length;
  return {
    id,
    seed: s.fighterSeed,
    name: s.project.name,
    team: s.team.name,
    tracks: s.tracks,
    pitch: s.project.pitch,
    description: s.project.description,
    twist: s.twist,
    panel: reviews[id].panelHundredths / 100,
    claims: { total: ev.length, supported: n("supported_by_code"), contradicted: n("contradicted") },
    live: laptop.length ? { flows: laptop.length, devices: 3, laptop: pass(laptop), android: pass(android), ios: pass(ios), passed: pass(laptop) + pass(android) + pass(ios) } : null,
  };
}

/** The fight the story is about: match 1 of the bracket. */
export const HEADLINE = { href: `/fights/${tournament.id}/0`, a: tape(tournament.projects[0].submissionId), b: tape(tournament.projects[1].submissionId) };

/** The fight a project is in: opponent, link, and (once decided) the result. */
export function fightOfProject(id) {
  const slot = tournament.projects.findIndex((p) => p.submissionId === id);
  const m = tournament.matches.find((x) => x.projectA === slot || x.projectB === slot);
  if (!m) return null;
  const other = tournament.projects[m.projectA === slot ? m.projectB : m.projectA];
  return { href: `/fights/${tournament.id}/${m.index}`, opponent: other.name, live: m.live, won: m.winner === slot };
}
