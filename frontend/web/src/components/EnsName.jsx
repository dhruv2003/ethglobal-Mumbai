/*
 * A fighter's or judge's ENSv2 name, with the records read live from ENS on Sepolia.
 * Renders nothing when the name hasn't been issued.
 */
import { useEnsName, ensAppUrl } from "../lib/ens.js";

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
