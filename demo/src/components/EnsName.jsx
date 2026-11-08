/*
 * A fighter's or judge's ENSv2 name, with the records read live from ENS on Sepolia.
 * Each one shows where it can be checked: the ENS app, the resolver contract on Etherscan,
 * and (for a fighter) the Arkiv entity behind its score. Renders nothing when the name
 * hasn't been issued.
 */
import { useState } from "react";
import { useEnsDirectory, useEnsName, ensAppUrl, scanAddress } from "../lib/ens.js";

const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network/entity-explorer";
const arkivLink = (key) => `${ARKIV_EXPLORER}?q=${encodeURIComponent(`$key = key(${key})`)}`;
const short = (h) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const when = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** The ENS logo mark, small. */
export function EnsMark({ size = 14 }) {
  return (
    <svg className="ensmark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M5.6 6.9c.3-.6.7-1.1 1.3-1.5L11.6 2 6.8 9.9s-.5-.8-.6-1.3c-.3-.6-.3-1.2-.2-1.7zM3.7 12.3c.1 1.4.8 2.7 1.9 3.6l6 4.1s-3.7-5.4-6.9-10.6c-.3-.5-.5-1.1-.6-1.7v-.1c-.2 1.5-.3 3-.4 4.7zM18.4 17.1c-.3.6-.7 1.1-1.3 1.5L12.4 22l4.8-7.9s.5.8.6 1.3c.3.6.3 1.2.2 1.7zM20.3 11.7c-.1-1.4-.8-2.7-1.9-3.6l-6-4.1s3.7 5.4 6.9 10.6c.3.5.5 1.1.6 1.7v.1c.2-1.5.3-3 .4-4.7z" />
    </svg>
  );
}

/** Where the record came from: read live from Sepolia just now, or the saved snapshot. */
function Source({ source, at, loading, onRecheck }) {
  return (
    <span className={`ens-src ens-src--${loading ? "loading" : source}`}>
      <span className="ens-src__dot" aria-hidden="true" />
      {loading ? "Reading from Sepolia…" : source === "live" ? `Read live from Sepolia · ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : `Sepolia didn't answer · snapshot from ${when(at)}`}
      {!loading && onRecheck && (
        <button type="button" className="ens-src__again" onClick={onRecheck}>
          Check again
        </button>
      )}
    </span>
  );
}

/** One text record as a row: key on the left, value on the right. */
function Rec({ k, children }) {
  return (
    <div className="ens-rec">
      <dt className="t-mono">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Project page: the fighter's name, the score the judges wrote to it, and how to check it. */
export function FighterEns({ projectId }) {
  const { name, records: r, address, resolver, cfg, loading, error, source, at, recheck } = useEnsName("project", projectId);
  if (!name) return null;
  return (
    <section className="ens-card" aria-label="ENS name">
      <header className="ens-card__head">
        <span className="ens-card__badge">
          <EnsMark /> On ENS
        </span>
        <a className="ens-card__name t-mono" href={ensAppUrl(cfg, name)} target="_blank" rel="noopener noreferrer">
          {name} ↗
        </a>
      </header>

      {error && !r && <span className="t-caption">ENS didn't answer: {error}</span>}
      {r && (
        <>
          {r["arena.score"] ? (
            <div className="ens-score">
              <span className="ens-score__num t-num">{r["arena.score"]}</span>
              <span className="t-caption">
                panel score written to ENS
                {r["arena.judges"] && ` · ${r["arena.judges"]} judges`}
                {r["arena.ranAt"] && ` · ${when(r["arena.ranAt"])}`}
              </span>
            </div>
          ) : (
            <span className="t-caption">No score on ENS yet. The judges write it here after their run.</span>
          )}
          <dl className="ens-recs m0">
            {r["arena.record"] && (
              <Rec k="arena.record">
                {r["arena.record"]}
                {Number(r["arena.titles"]) > 0 && ` · ${r["arena.titles"]} ${Number(r["arena.titles"]) === 1 ? "title" : "titles"}`}
              </Rec>
            )}
            {r["arena.lastFight"] && <Rec k="arena.lastFight">{r["arena.lastFight"]}</Rec>}
            {r["arena.arkiv"] && (
              <Rec k="arena.arkiv">
                <a className="t-mono" href={arkivLink(r["arena.arkiv"])} target="_blank" rel="noopener noreferrer" title={r["arena.arkiv"]}>
                  {short(r["arena.arkiv"])} ↗
                </a>
              </Rec>
            )}
            {r["com.github"] && (
              <Rec k="com.github">
                <a href={r["com.github"]} target="_blank" rel="noopener noreferrer">
                  {r["com.github"].replace(/^https:\/\/github\.com\//, "")} ↗
                </a>
              </Rec>
            )}
            {address && (
              <Rec k="addr (ETH)">
                <a className="t-mono" href={scanAddress(address)} target="_blank" rel="noopener noreferrer" title={address}>
                  {short(address)} ↗
                </a>
              </Rec>
            )}
            {resolver && (
              <Rec k="resolver">
                <a className="t-mono" href={scanAddress(resolver)} target="_blank" rel="noopener noreferrer" title={`PermissionedResolver ${resolver}`}>
                  {short(resolver)} ↗
                </a>
              </Rec>
            )}
          </dl>
        </>
      )}
      <Source source={source} at={at} loading={loading} onRecheck={recheck} />
      <span className="t-caption muted">Read in your browser through the ENS Universal Resolver, not from our server. The team owns this name. Only the arena can write its score.</span>
    </section>
  );
}

/** The persona published as ENSIP-26 agent-context, parsed when it's JSON. */
function persona(ctx) {
  try {
    return JSON.parse(ctx);
  } catch {
    return null;
  }
}

/** Judge card: the judge's name on ENS and, expandable, the records that prove the persona lives there. */
export function JudgeEns({ judgeId, detailed = false }) {
  const { name, records: r, resolver, cfg, loading, source, at, recheck } = useEnsName("judge", judgeId);
  const [open, setOpen] = useState(false);
  if (!name) return null;
  const ctx = r?.["agent-context"];
  const p = ctx ? persona(ctx) : null;
  return (
    <span className="jens">
      <span className="jens__row">
        <a className="jens__name t-mono" href={ensAppUrl(cfg, name)} target="_blank" rel="noopener noreferrer" title="Open on the ENS app">
          <EnsMark size={12} /> {name}
        </a>
        {ctx && <span className="jens__ok" title="Persona published as ENSIP-26 agent-context">agent-context ✓</span>}
        {(detailed || r) && (
          <button type="button" className="jens__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide proof" : "Proof"}
          </button>
        )}
      </span>
      {open && (
        <span className="jens__proof">
          <dl className="ens-recs m0">
            {r?.["arena.model"] && <Rec k="arena.model">{r["arena.model"]}</Rec>}
            {r?.["agent-endpoint[web]"] && (
              <Rec k="agent-endpoint[web]">
                <a href={r["agent-endpoint[web]"]} target="_blank" rel="noopener noreferrer">
                  {r["agent-endpoint[web]"].replace(/^https:\/\//, "")} ↗
                </a>
              </Rec>
            )}
            {p && (
              <Rec k="agent-context">
                {p.type} · {p.name}
                {p.title ? `, ${p.title}` : ""}
              </Rec>
            )}
            {resolver && (
              <Rec k="resolver">
                <a className="t-mono" href={scanAddress(resolver)} target="_blank" rel="noopener noreferrer" title={resolver}>
                  {short(resolver)} ↗
                </a>
              </Rec>
            )}
          </dl>
          <Source source={source} at={at} loading={loading} onRecheck={recheck} />
        </span>
      )}
    </span>
  );
}

/** A small "name.fightclub.eth" chip for cards and lists. Not a link (cards are links already). */
export function EnsChip({ kind = "project", id }) {
  const name = useEnsDirectory()?.[kind === "judge" ? "judges" : "projects"]?.[id];
  if (!name) return null;
  return (
    <span className="enschip t-mono" title={`${name}, an ENSv2 name on Sepolia`}>
      <EnsMark size={11} /> {name}
    </span>
  );
}
