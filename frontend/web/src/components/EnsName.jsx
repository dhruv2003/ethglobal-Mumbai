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


/** /fighters: the leaderboard, ranked from records read straight from ENS. Our server only lists the names. */
const winsOf = (rec) => Number(String(rec ?? "").split("-")[0]) || 0;
const lossesOf = (rec) => Number(String(rec ?? "").split("-")[1]) || 0;
/** Score first (the judges' panel), then fights won, then titles. */
const rankKey = (f) => {
  const r = f.ens?.records ?? {};
  return [Number(r["arena.score"]) || -1, winsOf(r["arena.record"]), Number(r["arena.titles"]) || 0];
};
const byRank = (a, b) => {
  const [x, y] = [rankKey(a), rankKey(b)];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};
const ranked = (f) => f.ens?.records?.["arena.score"] != null || winsOf(f.ens?.records?.["arena.record"]) + lossesOf(f.ens?.records?.["arena.record"]) > 0;

/**
 * Live rankings: every fighter, ranked by the judges' score, then fights won, then titles.
 * Reputation is read straight from each fighter's ENS name (Sepolia); refreshes every 30 s.
 * Once a fighter holds a title, this is the final standings.
 */
export function FightersPage() {
  const [state, setState] = useState({ loading: true, fighters: [], judges: [], cfg: null, error: null, at: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cfg, projects] = await Promise.all([ensConfig().catch(() => null), listProjects().catch(() => [])]);
        const read = (map, keys) =>
          Promise.all(Object.entries(map ?? {}).map(async ([id, name]) => ({ id, name, records: await resolveTexts(name, keys, cfg).catch(() => ({})) })));
        const [ensFighters, judges] = cfg ? await Promise.all([read(cfg.projects, cfg.fighterKeys), read(cfg.judges, cfg.judgeKeys)]) : [[], []];
        const ensById = new Map(ensFighters.map((f) => [f.id, f]));
        const fighters = projects.map((p) => ({ id: p.id, project: p, ens: ensById.get(p.id) ?? null }));
        for (const f of ensFighters) if (!projects.some((p) => p.id === f.id)) fighters.push({ id: f.id, project: null, ens: f });
        if (live) setState({ loading: false, fighters: fighters.sort(byRank), judges, cfg, error: !cfg && !projects.length ? "Nothing to show right now." : null, at: new Date() });
      } catch (e) {
        if (live) setState((s) => ({ ...s, loading: false, error: e.shortMessage ?? e.message }));
      }
    })();
    return () => {
      live = false;
    };
  }, [tick]);
  const { loading, fighters, judges, cfg, error, at } = state;
  const anyRanked = fighters.some(ranked);
  const final = fighters.some((f) => Number(f.ens?.records?.["arena.titles"]) > 0);
  const podium = anyRanked ? fighters.filter(ranked).slice(0, 3) : [];
  return (
    <div className={`roster ${anyRanked ? "" : "roster--unranked"}`}>
      <header className="roster__head">
        <span className={`rank-status ${final ? "rank-status--final" : ""}`}>
          {final ? (
            "Final standings"
          ) : (
            <>
              <span className="rank-status__dot" aria-hidden="true" /> Live
            </>
          )}
        </span>
        <h1 className="t-display-lg m0">
          {final ? (
            <>
              Final <span className="hl hl--crush">rankings</span>
            </>
          ) : (
            <>
              Live <span className="hl hl--crush">rankings</span>
            </>
          )}
        </h1>
        <p className="t-body muted m0 roster__sub">
          Ranked by the judges' score, then fights won, then titles. Every result lives on the fighter's ENS name, so anyone can check it.
          {at && !final && <span className="t-caption"> Updated {at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</span>}
        </p>
      </header>

      {loading && <p className="roster__note" aria-busy="true">Reading the standings…</p>}
      {error && <p className="roster__note" role="alert">{error}</p>}

      {!loading && fighters.length > 0 && <Podium top={podium} final={final} />}

      {fighters.length > 0 && (
        <section className="stack-xs" aria-labelledby="standings-h">
          <h2 id="standings-h" className="t-heading m0">
            Standings
          </h2>
          <ol className="roster__list">
            {fighters.map((f, i) => (
              <FighterRow key={f.id} f={f} cfg={cfg} rank={i + 1} isRanked={ranked(f)} />
            ))}
          </ol>
        </section>
      )}
      {!loading && !error && fighters.length === 0 && <p className="roster__note">No fighters yet. A project joins the rankings when it's submitted.</p>}

      {judges.length > 0 && (
        <section className="roster__judges" aria-labelledby="ringside-h">
          <h2 id="ringside-h" className="t-heading m0">
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

const personaOf = (f) => {
  const p = f.project;
  const name = p?.name || f.ens?.records?.name || f.ens?.name;
  const items = p ? fighterTraitItems(p, trackNameOf) : [];
  return { p, name, archetype: items.find((x) => x.id === "archetype"), gear: items.filter((x) => x.id !== "archetype") };
};

/** Top three on a podium (2 · 1 · 3). Empty places until fighters are scored. */
function Podium({ top, final }) {
  const places = [1, 0, 2]; // 2nd left, 1st middle, 3rd right
  return (
    <section className={`podium ${top.length ? "" : "podium--empty"}`} aria-label={final ? "Final podium" : "Current top three"}>
      {places.map((idx) => {
        const f = top[idx];
        const place = idx + 1;
        if (!f)
          return (
            <div key={place} className={`podium__spot podium__spot--${place}`}>
              <div className="podium__fighter podium__fighter--empty" aria-hidden="true">
                ?
              </div>
              <div className="podium__block">
                <span className="podium__place">{place}</span>
              </div>
            </div>
          );
        const { p, name, archetype } = personaOf(f);
        const r = f.ens?.records ?? {};
        const champ = final && place === 1;
        return (
          <Link key={place} to={`/projects/${encodeURIComponent(f.id)}`} className={`podium__spot podium__spot--${place}`}>
            {champ && <span className="podium__crown">Champion</span>}
            <div className="podium__fighter">
              <PixelFighter project={p ?? { seed: f.id, name, pitch: "", description: "", tracks: [] }} scale={place === 1 ? 6 : 5} />
            </div>
            <div className="podium__block">
              <span className="podium__place">{place}</span>
              <span className="podium__persona">{archetype?.label ?? name}</span>
              <span className="podium__project">{name}</span>
              <span className="podium__score t-num">{r["arena.score"] ?? "—"}</span>
            </div>
          </Link>
        );
      })}
      {!top.length && <p className="podium__wait">The podium fills in after the first judged fight.</p>}
    </section>
  );
}

/** One fighter in the standings. */
function FighterRow({ f, cfg, rank, isRanked }) {
  const { p, name, archetype, gear } = personaOf(f);
  const r = f.ens?.records ?? {};
  const tone = ["crush", "oracle", "sunny"][(rank - 1) % 3];
  return (
    <li className={`frow frow--${tone}`} style={{ "--i": rank }}>
      <span className={`frow__rank ${isRanked && rank <= 3 ? `frow__rank--${rank}` : ""}`}>{isRanked ? rank : "–"}</span>
      <Link to={`/projects/${encodeURIComponent(f.id)}`} className="frow__fighter" aria-label={`${archetype?.label ?? name}, fighting for ${name}`}>
        <span className="frow__spot" aria-hidden="true">
          <PixelFighter project={p ?? { seed: f.id, name, pitch: "", description: "", tracks: [] }} scale={4} />
        </span>
        <span className="frow__who">
          <span className="frow__persona">{archetype?.label ?? name}</span>
          <span className="frow__for">
            fights for <strong>{name}</strong>
            {p?.teamName ? ` · ${p.teamName}` : ""}
          </span>
          {r["arena.lastFight"] ? <span className="frow__tag">Last fight: {r["arena.lastFight"]}</span> : archetype?.why && <span className="frow__tag">{archetype.why}</span>}
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
            <dd>{r["arena.score"] ?? "—"}</dd>
          </div>
          <div>
            <dt>W–L</dt>
            <dd>{r["arena.record"] ? r["arena.record"].replace("-", "–") : "0–0"}</dd>
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
