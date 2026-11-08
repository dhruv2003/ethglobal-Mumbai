/*
 * The tournament as a tree: one column per round, the champion on the right. Winners move
 * along the lines as the chain finalizes their matches; slots not yet decided say which
 * match feeds them. Every played or open match links to its fight.
 */
import { StatusPill } from "@ds/ui.jsx";
import { Link } from "../lib/router.jsx";
import { feeders } from "../lib/pools.js";
import { PixelFighter } from "./PixelFighter.jsx";

const STATUS = { live: ["live", "Live"], review: ["reward", "Judges deciding"], finalized: ["neutral", "Final"], scheduled: ["neutral", "Up next"], void: ["neutral", "Void"] };
const SHORT = { Quarterfinals: "QF", Semifinals: "SF", Final: "F" };
const score = (h) => (h ? (h / 100).toFixed(1) : null);

/** A label for each match: QF1, SF2, F. */
function labelOf(t, index) {
  for (const r of t.rounds) {
    const at = r.matches.indexOf(index);
    if (at >= 0) return r.matches.length === 1 ? SHORT[r.name] ?? r.name : `${SHORT[r.name] ?? `R${r.round}`}${at + 1}`;
  }
  return `M${index + 1}`;
}

function Side({ t, match, slot, feederLabel }) {
  const id = slot === "a" ? match.a : match.b;
  const p = id == null ? null : t.projects[id];
  const decided = match.winner != null;
  const won = decided && match.winner === id;
  const s = slot === "a" ? match.scoreA : match.scoreB;
  if (!p) {
    return (
      <span className="bk-side bk-side--tbd">
        <span className="bk-side__face bk-side__face--tbd" aria-hidden="true">?</span>
        <span className="bk-side__name">{feederLabel ? `Winner of ${feederLabel}` : "To be drawn"}</span>
      </span>
    );
  }
  return (
    <span className={`bk-side ${won ? "bk-side--won" : decided ? "bk-side--out" : ""}`}>
      <span className="bk-side__face" aria-hidden="true">
        <PixelFighter project={p} scale={2} />
      </span>
      <span className="bk-side__name">{p.name}</span>
      {decided && <span className="bk-side__score t-num">{score(s)}</span>}
      {won && <span className="visually-hidden">, winner</span>}
    </span>
  );
}

function MatchBox({ t, match }) {
  const [tone, word] = match.a == null || match.b == null ? ["neutral", "Waiting"] : (STATUS[match.status] ?? STATUS.scheduled);
  const feed = feeders(match.index, t.count);
  const body = (
    <>
      <span className="bk-match__top">
        <span className="bk-match__label t-mono">{labelOf(t, match.index)}</span>
        <StatusPill tone={tone}>{word}</StatusPill>
      </span>
      <Side t={t} match={match} slot="a" feederLabel={feed && labelOf(t, feed[0])} />
      <Side t={t} match={match} slot="b" feederLabel={feed && labelOf(t, feed[1])} />
    </>
  );
  const cls = `bk-match bk-match--${match.a == null || match.b == null ? "waiting" : match.status}`;
  return match.opened ? (
    <Link to={`/fights/${t.id}/${match.index}`} className={cls} aria-label={`${labelOf(t, match.index)}: open the fight`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Bracket({ t }) {
  const final = t.matches[t.rounds.at(-1)?.matches[0]];
  const champId = t.champion ?? (final?.winner != null ? final.winner : null);
  const champ = champId == null ? null : t.projects[champId];
  const done = t.matches.filter((m) => m.winner != null).length;
  const alive = new Set(t.projects.map((_, i) => i));
  for (const m of t.matches) if (m.winner != null) alive.delete(m.winner === m.a ? m.b : m.a);

  return (
    <section className="bk" aria-labelledby={`bk-${t.id}`}>
      <header className="bk__head">
        <div>
          <h2 id={`bk-${t.id}`} className="t-heading m0">
            The bracket
          </h2>
          <p className="t-caption m0 muted">
            {t.title} · {t.count} fighters · {done} of {t.matches.length} fights decided · {alive.size} still standing
          </p>
        </div>
        {t.matching?.algorithmVersion && (
          <p className="t-caption m0 bk__how">
            First round paired by <b>{t.matching.algorithmVersion}</b>: projects that pitch the same idea meet first. Winners move right.
          </p>
        )}
      </header>
      <div className="bk__scroll">
        <ol className="bk__tree m0" style={{ "--rounds": t.rounds.length + 1 }}>
          {t.rounds.map((r, ri) => (
            <li key={r.round} className={`bk-round ${ri === 0 ? "bk-round--first" : ""}`}>
              <span className="bk-round__name">{r.name}</span>
              <div className="bk-round__cells">
                {/* Pairs of matches feed one match in the next round; the pair draws the joining line. */}
                {chunk(r.matches, r.matches.length > 1 ? 2 : 1).map((pair, pi) => (
                  <div key={pi} className={`bk-pair ${pair.length === 2 ? "bk-pair--two" : ""}`}>
                    {pair.map((mi) => (
                      <div key={mi} className="bk-cell">
                        <MatchBox t={t} match={t.matches[mi]} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </li>
          ))}
          <li className="bk-round bk-round--champ">
            <span className="bk-round__name">Champion</span>
            <div className="bk-round__cells">
              <div className="bk-pair">
                <div className="bk-cell">
                  <div className={`bk-champ ${champ ? "bk-champ--crowned" : ""}`}>
                    <span className="bk-champ__cup" aria-hidden="true">🏆</span>
                    {champ ? (
                      <>
                        <span className="bk-champ__face" aria-hidden="true">
                          <PixelFighter project={champ} scale={3} />
                        </span>
                        <b>{champ.name}</b>
                      </>
                    ) : (
                      <span className="t-caption muted">Decided in the final</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
