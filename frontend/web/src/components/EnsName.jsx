/*
 * A fighter's or judge's ENSv2 name, with the records read live from ENS on Sepolia.
 * Renders nothing when the name hasn't been issued.
 */
import { useEffect, useState } from "react";
import { ensConfig, resolveTexts, useEnsName, ensAppUrl } from "../lib/ens.js";
import { Link } from "../lib/router.jsx";

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

const scoreOf = (f) => Number(f.records["arena.score"]) || -1;

/** /fighters: the leaderboard, ranked from records read straight from ENS. Our server only lists the names. */
export function FightersPage() {
  const [state, setState] = useState({ loading: true, fighters: [], judges: [], cfg: null, error: null });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const cfg = await ensConfig();
        if (!cfg) throw new Error("The list of names isn't available right now.");
        const read = (map, keys) => Promise.all(Object.entries(map ?? {}).map(async ([id, name]) => ({ id, name, records: await resolveTexts(name, keys, cfg) })));
        const [fighters, judges] = await Promise.all([read(cfg.projects, cfg.fighterKeys), read(cfg.judges, cfg.judgeKeys)]);
        if (live) setState({ loading: false, fighters: fighters.sort((a, b) => scoreOf(b) - scoreOf(a)), judges, cfg, error: null });
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
    <div className="ens-board">
      <h1 className="t-display m0">Fighters</h1>
      <p className="t-body muted">Every fighter's reputation lives on its ENS name, so it goes with the team and anyone can check it. This page reads it from ENS on Sepolia, not from our server.</p>
      {loading && <p className="t-caption" aria-busy="true">Reading from ENS…</p>}
      {error && <p className="t-caption" role="alert">ENS didn't answer: {error}</p>}
      {!loading && !error && fighters.length === 0 && <p className="t-caption">No fighters on ENS yet. A project gets its name when it's submitted.</p>}
      {fighters.length > 0 && (
        <ol className="ens-board__list">
          {fighters.map((f) => (
            <li key={f.id} className="ens-board__row">
              <div className="ens-board__who">
                <Link to={`/projects/${encodeURIComponent(f.id)}`} className="t-body-strong">{f.records.name || f.name}</Link>
                <a className="t-mono-caption" href={ensAppUrl(cfg, f.name)} target="_blank" rel="noopener noreferrer">{f.name} ↗</a>
              </div>
              <dl className="ens-board__stats t-num">
                <div><dt className="t-caption">Score</dt><dd>{f.records["arena.score"] ?? "—"}</dd></div>
                <div><dt className="t-caption">Record</dt><dd>{f.records["arena.record"] ?? "—"}</dd></div>
                <div><dt className="t-caption">Titles</dt><dd>{f.records["arena.titles"] ?? "0"}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      {judges.length > 0 && (
        <>
          <h2 className="t-heading m0">AI judges</h2>
          <ul className="ens-board__list">
            {judges.map((j) => (
              <li key={j.id} className="ens-board__row">
                <div className="ens-board__who">
                  <span className="t-body-strong">{j.records.name || j.name}</span>
                  <a className="t-mono-caption" href={ensAppUrl(cfg, j.name)} target="_blank" rel="noopener noreferrer">{j.name} ↗</a>
                </div>
                <span className="t-caption">{j.records["agent-context"] ? "Persona published on ENS (ENSIP-26)" : j.records.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
