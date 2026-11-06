/*
 * A fighter's or judge's ENSv2 name, with the records read live from ENS on Sepolia.
 * Renders nothing when the name hasn't been issued.
 */
import { useEffect, useState } from "react";
import { ensConfig, resolveTexts, useEnsName, ensAppUrl } from "../lib/ens.js";
import { Link } from "../lib/router.jsx";
import { listProjects } from "../lib/projects.js";
import { trackNameOf } from "../lib/events.js";
import { Ring } from "./Arena.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";

const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network/entity-explorer";
const arkivLink = (key) => `${ARKIV_EXPLORER}?q=${encodeURIComponent(`$key = key(${key})`)}`;

/** Project page, team tab: the fighter's name and the score the judges wrote to it. */
export function FighterEns({ projectId }) {
  const { name, records: r, cfg, loading, error } = useEnsName("project", projectId);
  if (!name) return null;
  return (
    <div className="zgpanel" aria-label="ENS name">
      <div className="zgpanel__head">
        <span className="t-label">On ENS</span>
        <a className="t-mono" href={ensAppUrl(cfg, name)} target="_blank" rel="noopener noreferrer">
          {name} ↗
        </a>
      </div>
      {loading && <span className="t-caption">Reading from ENS…</span>}
      {error && <span className="t-caption">ENS didn't answer: {error}</span>}
      {r && (
        <>
          {r["arena.score"] ? (
            <span className="t-caption">
              Panel score <span className="t-body-strong">{r["arena.score"]}</span>
              {r["arena.judges"] && ` · ${r["arena.judges"]} judges scored`}
              {r["arena.ranAt"] && ` · ${new Date(r["arena.ranAt"]).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`}
            </span>
          ) : (
            <span className="t-caption">No score on ENS yet. The judges write it here after their run.</span>
          )}
          {r["arena.record"] && (
            <span className="t-caption">
              Fight record <span className="t-body-strong">{r["arena.record"]}</span>
              {Number(r["arena.titles"]) > 0 && ` · ${r["arena.titles"]} ${Number(r["arena.titles"]) === 1 ? "title" : "titles"}`}
              {r["arena.lastFight"] && ` · last: ${r["arena.lastFight"]}`}
            </span>
          )}
          {r["arena.arkiv"] && (
            <span className="t-caption">
              <a href={arkivLink(r["arena.arkiv"])} target="_blank" rel="noopener noreferrer">
                The run behind this score, on Arkiv
              </a>
            </span>
          )}
        </>
      )}
      <span className="t-caption">Read live from ENSv2 on Sepolia, not from our server. The team owns this name; only the arena can write its score.</span>
    </div>
  );
}

/** Judge card: the judge's name, and where its persona (ENSIP-26 agent-context) lives. */
export function JudgeEns({ judgeId }) {
  const { name, records: r, cfg } = useEnsName("judge", judgeId);
  if (!name) return null;
  return (
    <span className="t-mono-caption jcard__ens">
      <a href={ensAppUrl(cfg, name)} target="_blank" rel="noopener noreferrer" title={r?.["agent-context"] ? "Persona published as ENSIP-26 agent-context" : "ENS name"}>
        {name}
      </a>
      {r?.["agent-context"] && " · agent-context ✓"}
    </span>
  );
}

/**
 * One line under a fighter's name where people bet: their ENS name, and the score and record read
 * from it. Plain text, because it sits inside the pick buttons. Nothing when the fighter has no name.
 */
export function FighterEnsLine({ projectId }) {
  const { name, records: r } = useEnsName("project", projectId);
  if (!name) return null;
  const facts = [r?.["arena.score"] && `score ${r["arena.score"]}`, r?.["arena.record"] && `${r["arena.record"]} record`].filter(Boolean);
  return (
    <span className="ens-line">
      <span className="ens-line__name">{name}</span>
      {facts.length > 0 && <span className="ens-line__facts t-num">{facts.join(" · ")}</span>}
    </span>
  );
}

const scoreOf = (ens) => Number(ens?.records?.["arena.score"]) || -1;

/** /fighters: the leaderboard, ranked from records read straight from ENS. Our server only lists the names. */
export function FightersPage() {
  const [state, setState] = useState({ loading: true, fighters: [], judges: [], cfg: null, error: null });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cfg, projects] = await Promise.all([ensConfig().catch(() => null), listProjects().catch(() => [])]);
        const read = (map, keys) =>
          Promise.all(Object.entries(map ?? {}).map(async ([id, name]) => ({ id, name, records: await resolveTexts(name, keys, cfg).catch(() => ({})) })));
        const [ensFighters, judges] = cfg ? await Promise.all([read(cfg.projects, cfg.fighterKeys), read(cfg.judges, cfg.judgeKeys)]) : [[], []];
        const ensById = new Map(ensFighters.map((f) => [f.id, f]));
        // Every project is a fighter; its ENS name adds the on-chain reputation.
        const fighters = projects.map((p) => ({ id: p.id, project: p, ens: ensById.get(p.id) ?? null }));
        for (const f of ensFighters) if (!projects.some((p) => p.id === f.id)) fighters.push({ id: f.id, project: null, ens: f });
        if (live) setState({ loading: false, fighters: fighters.sort((a, b) => scoreOf(b.ens) - scoreOf(a.ens)), judges, cfg, error: !cfg && !projects.length ? "Nothing to show right now." : null });
      } catch (e) {
        if (live) setState((s) => ({ ...s, loading: false, error: e.shortMessage ?? e.message }));
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const { loading, fighters, judges, cfg, error } = state;
  const scored = fighters.some((f) => f.ens?.records?.["arena.score"] != null);
  return (
    <div className={`roster ${scored ? "" : "roster--unranked"}`}>
      <header className="roster__head">
        <span className="roster__eyebrow">Fight night roster</span>
        <h1 className="roster__title m0">Fighters</h1>
        <p className="roster__sub m0">Every project steps into the ring as its own fighter. Their record lives on their ENS name, so it travels with the team and anyone can check it.</p>
      </header>

      {loading && <p className="roster__note" aria-busy="true">Calling the fighters to the ring…</p>}
      {error && <p className="roster__note" role="alert">{error}</p>}
      {!loading && !error && fighters.length === 0 && <p className="roster__note">No fighters yet. A project becomes one when it's submitted.</p>}

      {fighters.length > 0 && (
        <>
          <ol className="roster__list">
            {fighters.map((f, i) => (
              <FighterRow key={f.id} f={f} cfg={cfg} rank={i + 1} scored={scored} />
            ))}
          </ol>
        </>
      )}

      {judges.length > 0 && (
        <section className="roster__judges" aria-labelledby="ringside-h">
          <h2 id="ringside-h" className="roster__h2 m0">
            Ringside judges
          </h2>
          <ul className="ringside">
            {judges.map((j) => {
              const label = j.records.name || j.name.replace(/^judge-/, "").replace(/\.[^.]+\.eth$/, "").replace(/-/g, " ");
              return (
                <li key={j.id} className="ringside__judge">
                  <span className="ringside__face">
                    <PixelFighter project={{ seed: j.id, name: label, pitch: j.records.description ?? "", description: "", tracks: [] }} scale={3} label={`${label}, judge`} />
                  </span>
                  <span className="ringside__text">
                    <span className="ringside__name">{label}</span>
                    <a className="ringside__ens" href={ensAppUrl(cfg, j.name)} target="_blank" rel="noopener noreferrer">
                      {j.name} ↗
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One fighter in the standings: rank, sprite under a spotlight, persona, gear, record. */
function FighterRow({ f, cfg, rank, scored }) {
  const p = f.project;
  const r = f.ens?.records ?? {};
  const projectName = p?.name || r.name || f.ens?.name;
  const persona = p ? fighterTraitItems(p, trackNameOf) : [];
  const archetype = persona.find((x) => x.id === "archetype");
  const gear = persona.filter((x) => x.id !== "archetype");
  const score = r["arena.score"];
  return (
    <li className="frow">
      <span className={`frow__rank ${scored && rank <= 3 ? `frow__rank--${rank}` : ""}`}>{scored && score != null ? rank : "–"}</span>
      <Link to={`/projects/${encodeURIComponent(f.id)}`} className="frow__fighter" aria-label={`${archetype?.label ?? projectName}, fighting for ${projectName}`}>
        <span className="frow__spot" aria-hidden="true">
          <PixelFighter project={p ?? { seed: f.id, name: projectName, pitch: "", description: "", tracks: [] }} scale={4} />
        </span>
        <span className="frow__who">
          <span className="frow__persona">{archetype?.label ?? projectName}</span>
          <span className="frow__for">
            fights for <strong>{projectName}</strong>
            {p?.teamName ? ` · ${p.teamName}` : ""}
          </span>
          {archetype?.why && <span className="frow__tag">{archetype.why}</span>}
          {gear.length > 0 && (
            <span className="frow__gear">
              {gear.map((g) => (
                <span key={g.id} className="frow__item" title={g.why}>
                  {g.label}
                </span>
              ))}
            </span>
          )}
        </span>
      </Link>
      <div className="frow__side">
        <dl className="frow__stats">
          <div>
            <dt>Score</dt>
            <dd>{score ?? "—"}</dd>
          </div>
          <div>
            <dt>Record</dt>
            <dd>{r["arena.record"] ?? "0–0"}</dd>
          </div>
          <div>
            <dt>Titles</dt>
            <dd>{r["arena.titles"] ?? "0"}</dd>
          </div>
        </dl>
        {f.ens && cfg ? (
          <a className="frow__ens" href={ensAppUrl(cfg, f.ens.name)} target="_blank" rel="noopener noreferrer" title={f.ens.name}>
            {f.ens.name} ↗
          </a>
        ) : (
          <span className="frow__ens frow__ens--none">ENS name on its way</span>
        )}
      </div>
    </li>
  );
}
