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
  return (
    <div className="fighters">
      <header className="fighters__head">
        <h1 className="t-display m0">Fighters</h1>
        <p className="t-body muted m0">Every project fights as its own pixel fighter. Their reputation (score, record, titles) lives on their ENS name, so it goes with the team and anyone can check it.</p>
      </header>
      {loading && (
        <div className="fighters__grid" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton skeleton--seat" />
          ))}
        </div>
      )}
      {error && <p className="t-caption" role="alert">{error}</p>}
      {!loading && !error && fighters.length === 0 && <p className="t-caption">No fighters yet. A project becomes one when it's submitted.</p>}
      {fighters.length > 0 && (
        <ol className="fighters__grid">
          {fighters.map((f, i) => (
            <FighterCard key={f.id} f={f} cfg={cfg} rank={i + 1} />
          ))}
        </ol>
      )}
      {judges.length > 0 && (
        <section className="fighters__judges" aria-labelledby="judges-h">
          <h2 id="judges-h" className="t-heading m0">AI judges</h2>
          <ul className="judges-strip">
            {judges.map((j) => {
              const label = j.records.name || j.name.replace(/^judge-/, "").replace(/\.[^.]+\.eth$/, "").replace(/-/g, " ");
              return (
                <li key={j.id} className="judge-tile">
                  <Ring compact className="judge-tile__ring">
                    <PixelFighter project={{ seed: j.id, name: label, pitch: j.records.description ?? "", description: "", tracks: [] }} scale={4} label={`${label}, judge`} />
                  </Ring>
                  <div className="judge-tile__text">
                    <span className="t-body-strong judge-tile__name">{label}</span>
                    <span className="t-caption judge-tile__desc">{j.records.description || "AI judge: scores every project in its tournaments."}</span>
                    {j.records["arena.model"] && <span className="chip chip--tag judge-tile__model">{j.records["arena.model"]}</span>}
                    <a className="t-mono-caption" href={ensAppUrl(cfg, j.name)} target="_blank" rel="noopener noreferrer">
                      {j.name} ↗
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function FighterCard({ f, cfg, rank }) {
  const p = f.project;
  const r = f.ens?.records ?? {};
  const name = p?.name || r.name || f.ens?.name;
  const persona = p ? fighterTraitItems(p, trackNameOf) : [];
  const archetype = persona.find((x) => x.id === "archetype");
  const gear = persona.filter((x) => x.id !== "archetype");
  const pitch = p?.pitch || r.description || "";
  const blurb = (p?.description || "").split(/\n{2,}/)[0];
  return (
    <li className="fcard2">
      <Link to={`/projects/${encodeURIComponent(f.id)}`} className="fcard2__link" aria-label={`${name}: open the project`}>
        {r["arena.score"] != null && <span className="fcard2__rank t-num">#{rank}</span>}
        <Ring className="fcard2__ring">
          <PixelFighter project={p ?? { seed: f.id, name, pitch, description: "", tracks: [] }} scale={6} className="fighter--enter" />
        </Ring>
        <div className="fcard2__body">
          <div className="fcard2__title">
            <h2 className="t-heading m0">{name}</h2>
            {p?.teamName && <span className="t-caption">by {p.teamName}</span>}
          </div>
          {archetype && (
            <p className="fcard2__persona m0">
              <span className="fcard2__as">{archetype.label}</span>
              <span className="t-caption"> · {archetype.why}</span>
            </p>
          )}
          {pitch && <p className="fcard2__pitch m0">{pitch}</p>}
          {blurb && blurb !== pitch && <p className="t-body muted fcard2__desc m0">{blurb}</p>}
          {gear.length > 0 && (
            <ul className="fcard2__gear" aria-label="Gear">
              {gear.map((g) => (
                <li key={g.id} className="chip chip--tag" title={g.why}>
                  {g.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Link>
      <footer className="fcard2__foot">
        <dl className="fcard2__stats t-num">
          <div>
            <dt className="t-caption">Score</dt>
            <dd>{r["arena.score"] ?? "—"}</dd>
          </div>
          <div>
            <dt className="t-caption">Record</dt>
            <dd>{r["arena.record"] ?? "—"}</dd>
          </div>
          <div>
            <dt className="t-caption">Titles</dt>
            <dd>{r["arena.titles"] ?? "0"}</dd>
          </div>
        </dl>
        {f.ens && cfg ? (
          <a className="fcard2__ens t-mono-caption" href={ensAppUrl(cfg, f.ens.name)} target="_blank" rel="noopener noreferrer">
            {f.ens.name} ↗
          </a>
        ) : (
          <span className="t-caption muted">ENS name on its way</span>
        )}
      </footer>
    </li>
  );
}
