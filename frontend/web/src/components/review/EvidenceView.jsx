/*
 * Evidence sub-tab: what the agents actually checked.
 *  - Claims: one segmented bar for the split, then the claims themselves, one
 *    line each, filterable; open one to see what the code showed and where.
 *  - The code: tests found and how much was built at the event.
 *  - What the vision model saw in the live-test screenshots.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EvidenceList } from "../ZeroGProof.jsx";
import { CLAIM } from "./useReviewData.js";

export function ClaimBar({ evidence, big }) {
  const total = evidence.length;
  const parts = CLAIM.map((c) => ({ ...c, n: evidence.filter((e) => e.status === c.id).length })).filter((c) => c.n);
  return (
    <div className={`cbar ${big ? "cbar--big" : ""}`} role="img" aria-label={parts.map((p) => `${p.n} ${p.word.toLowerCase()}`).join(", ")}>
      {parts.map((p, i) => (
        <motion.span
          key={p.id}
          className={`cbar__seg cbar__seg--${p.tone}`}
          style={{ flexGrow: p.n }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.1 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          title={`${p.n} ${p.word.toLowerCase()}`}
        >
          {big && p.n / total > 0.08 && (
            <span className="cbar__n t-num">
              {p.mark} {p.n}
            </span>
          )}
        </motion.span>
      ))}
    </div>
  );
}

function Claims({ evidence, commit }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const counts = Object.fromEntries(CLAIM.map((c) => [c.id, evidence.filter((e) => e.status === c.id).length]));
  const rows = filter === "all" ? evidence : evidence.filter((e) => e.status === filter);
  return (
    <section className="rv-card ev-claims" aria-labelledby="claims-h">
      <header className="rv-card__head">
        <h3 id="claims-h" className="m0">
          Claims vs. code
        </h3>
        <span className="rv-card__sub t-num">
          {evidence.length} checked{commit ? ` at ${commit.slice(0, 7)}` : ""}
        </span>
      </header>
      <ClaimBar evidence={evidence} big />
      <div className="ev-filter" role="group" aria-label="Filter claims">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="t-num">{evidence.length}</span>
        </button>
        {CLAIM.filter((c) => counts[c.id]).map((c) => (
          <button key={c.id} type="button" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)} className={`ev-filter--${c.tone}`}>
            <span className={`ev-mark ev-mark--${c.tone}`} aria-hidden="true">
              {c.mark}
            </span>
            {c.word} <span className="t-num">{counts[c.id]}</span>
          </button>
        ))}
      </div>
      <ul className="ev-list m0">
        <AnimatePresence initial={false}>
          {rows.map((e) => {
            const c = CLAIM.find((x) => x.id === e.status) ?? CLAIM[2];
            const isOpen = open === e.id;
            return (
              <motion.li key={e.id} layout className={`ev-row ${isOpen ? "ev-row--open" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <button type="button" className="ev-row__btn" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                  <span className={`ev-mark ev-mark--${c.tone}`} aria-hidden="true">
                    {c.mark}
                  </span>
                  <span className="ev-row__claim">{e.claim}</span>
                  <span className="ev-row__src">{e.source === "code" ? "found in code" : "team says"}</span>
                  <span className="ev-row__chev" aria-hidden="true">
                    ›
                  </span>
                  <span className="visually-hidden"> · {c.word}</span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div className="ev-row__more" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                      <p className="m0">
                        <strong className={`ev-word ev-word--${c.tone}`}>{c.word}.</strong> {e.observation}
                      </p>
                      {e.refs?.length > 0 && (
                        <span className="ev-refs">
                          {e.refs.map((r) => (
                            <code key={r}>{r}</code>
                          ))}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}

export function CodeFacts({ dossier: d }) {
  const c = d.continuity;
  const total = c ? (c.commitsBefore ?? 0) + (c.commitsDuringEvent ?? 0) : 0;
  const t = d.tests?.found ?? {};
  const tests = (t.vitestCases ?? 0) + (t.forgeTests ?? 0) + (t.pyTests ?? 0);
  const pct = total ? c.commitsDuringEvent / total : 0;
  const C = 2 * Math.PI * 26;
  return (
    <div className="ev-code">
      <div className="ev-stat ev-stat--oracle">
        <span className="ev-stat__icon" aria-hidden="true">
          ⚗︎
        </span>
        <span className="ev-stat__n t-num">{tests}</span>
        <span className="ev-stat__l">tests found</span>
        <span className="ev-stat__s">
          {[t.vitestCases && `${t.vitestCases} JS/TS`, t.forgeTests && `${t.forgeTests} Solidity`, t.pyTests && `${t.pyTests} Python`].filter(Boolean).join(" · ") || "counted, not run"}
        </span>
      </div>
      {c && (
        <div className="ev-stat ev-stat--sunny">
          <svg className="ev-stat__ring" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="26" className="ev-stat__track" />
            <motion.circle cx="32" cy="32" r="26" className="ev-stat__fill" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - pct) }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          </svg>
          <span className="ev-stat__n t-num">
            {c.commitsDuringEvent}
            <small>/{total}</small>
          </span>
          <span className="ev-stat__l">commits at the event</span>
          <span className="ev-stat__s">{c.authors ? `${c.authors} authors` : ""}</span>
        </div>
      )}
    </div>
  );
}

export function EvidenceView({ project, data, live }) {
  const d = data.dossier;
  const pending = live?.running || live?.review?.status === "queued";
  return (
    <div className="ev">
      {d?.evidence?.length > 0 ? (
        <div className="ev__top">
          <Claims evidence={d.evidence} commit={d.commit} />
          <aside className="rv-card ev-side">
            <header className="rv-card__head">
              <h3 className="m0">The code</h3>
            </header>
            <CodeFacts dossier={d} />
            {d.reviewer?.method && <p className="ev-side__how m0">{d.reviewer.method}</p>}
          </aside>
        </div>
      ) : (
        <div className="rv-empty">
          <span className="rv-empty__art" aria-hidden="true">
            ⌕
          </span>
          <p className="m0">{pending ? "The fact-check is still running." : "No fact-check yet."}</p>
        </div>
      )}
      <EvidenceList evidence={data.result?.evidence} />
    </div>
  );
}
