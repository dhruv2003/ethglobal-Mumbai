/*
 * /graph: the knowledge graph as a canvas you can pan, zoom and drag.
 * Projects, judges, tracks and tech are nodes; scores, fights, tracks and
 * dependencies are edges. Click a node to see what the graph knows about it.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SplitWords, bouncy, easeOut } from "./fx.jsx";
import { api, peekApi } from "../lib/api.js";
import { sameData } from "../lib/cache.js";
import { NODE_TYPES } from "../lib/graphLayout.js";
import { GraphCanvas } from "./GraphCanvas.jsx";
import { GraphDetails } from "./GraphDetails.jsx";

const REL_LABEL = { SCORED: "scored", BEAT: "beat", IN_TRACK: "in track", USES: "uses" };

export function GraphPage() {
  // Last visit's graph paints at once; the fresh one replaces it only if something changed (no layout jump).
  const [state, setState] = useState(() => {
    const graph = peekApi("/graph");
    const judges = peekApi("/graph/judges");
    return graph && judges ? { graph, judges } : { loading: true };
  });
  const [hidden, setHidden] = useState(() => new Set());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([api("/graph"), api("/graph/judges")])
      .then(([graph, judges]) => setState((s) => (sameData(s.graph, graph) && sameData(s.judges, judges) ? s : { graph, judges })))
      .catch((e) => setState((s) => (s.graph ? s : { error: e.message })));
  }, []);

  const counts = useMemo(() => {
    const c = {};
    for (const n of state.graph?.nodes ?? []) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [state.graph]);

  const toggle = (t) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  return (
    <div className="kg-page">
      <header className="kg-head">
        <div className="kg-head__text">
          <span className="eyebrow rise">The map</span>
          <h1 className="t-display-lg m0">
            <SplitWords>Knowledge graph</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
            Who scored whom, who beat whom, and which projects share a stack. Click anything.
          </p>
        </div>
        {state.graph && (
          <dl className="kg-kpis rise" style={{ "--i": 2 }}>
            {Object.entries(NODE_TYPES).map(([t, meta]) => (
              <div key={t}>
                <dt>
                  <span className={`kg-dot kg-dot--${t}`} aria-hidden="true" /> {meta.label}
                </dt>
                <dd className="t-num">{counts[t] ?? 0}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      {state.loading ? (
        <div className="card kg-shell skeleton" style={{ minHeight: 560 }} aria-busy="true" />
      ) : state.error ? (
        <div className="card card--surface">
          <h2 className="t-heading m0">The graph is offline</h2>
          <p className="t-body m0 muted">We can't reach the backend right now. Try again in a minute.</p>
        </div>
      ) : !state.graph.nodes.length ? (
        <div className="card card--surface">
          <h2 className="t-heading m0">Nothing to connect yet</h2>
          <p className="t-body m0 muted">The graph fills in as projects are submitted, reviewed and judged.</p>
        </div>
      ) : (
        <motion.div className="kg-layout" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
          <div className="kg-main">
            <div className="kg-toolbar">
              <div className="kg-legend" role="group" aria-label="Show or hide node types">
                {Object.entries(NODE_TYPES).map(([t, meta]) => (
                  <button key={t} type="button" className={`kg-toggle ${hidden.has(t) ? "is-off" : ""}`} aria-pressed={!hidden.has(t)} onClick={() => toggle(t)}>
                    <span className={`kg-dot kg-dot--${t}`} aria-hidden="true" />
                    {meta.label}
                  </button>
                ))}
              </div>
              <span className="kg-legend__edges t-caption muted" aria-hidden="true">
                <i className="kg-line kg-line--scored" /> scored <i className="kg-line kg-line--beat" /> beat <i className="kg-line kg-line--uses" /> uses
              </span>
            </div>
            <div className="kg-stage">
              <GraphCanvas data={state.graph} hidden={hidden} selected={selected} onSelect={setSelected} />
            </div>
          </div>
          <aside className="kg-rail" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {selected ? (
                <motion.div key={selected} className="kg-rail__in" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={bouncy}>
                  <button type="button" className="kg-back" onClick={() => setSelected(null)}>
                    ← All insights
                  </button>
                  <GraphDetails id={selected} data={state.graph} judges={state.judges} onSelect={setSelected} />
                </motion.div>
              ) : (
                <motion.div key="insights" className="kg-rail__in" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={bouncy}>
                  <Insights data={state.graph} judges={state.judges} onSelect={setSelected} />
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        </motion.div>
      )}
    </div>
  );
}

/** What the graph says at a glance: fights decided, how each judge leans, the shared stack, sponsor reach. */
function Insights({ data, judges, onSelect }) {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const name = (id) => byId.get(id)?.name ?? id.split(":").slice(1).join(":");
  const beats = data.edges.filter((e) => e.rel === "BEAT");
  const count = (rel) => {
    const m = new Map();
    for (const e of data.edges) if (e.rel === rel) m.set(e.to, (m.get(e.to) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const stack = count("USES").filter(([, n]) => n > 1).slice(0, 4);
  const tracks = count("IN_TRACK").filter(([id]) => byId.get(id)?.sponsor).slice(0, 5);
  const maxTrack = Math.max(1, ...tracks.map(([, n]) => n));
  const maxLean = Math.max(1, ...(judges ?? []).map((j) => Math.abs(j.vsPanel)));
  return (
    <div className="kg-ins">
      {beats.length > 0 && (
      <section>
        <h3>Fights decided</h3>
        <ul className="m0">
          {beats.map((e) => (
            <li key={`${e.from}${e.to}`}>
              <button type="button" className="kg-row" onClick={() => onSelect(e.from)}>
                <b>{name(e.from)}</b> <span className="kg-row__beat">beat</span> <span className="muted">{name(e.to)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      )}
      <section>
        <h3>How the judges lean</h3>
        <ul className="m0">
          {(judges ?? []).map((j) => (
            <li key={j.judgeId}>
              <button type="button" className="kg-row kg-lean" onClick={() => onSelect(`judge:${j.judgeId}`)}>
                <span className="kg-lean__name">{j.name.split(" ")[0]}</span>
                <span className="kg-lean__bar" aria-hidden="true">
                  <span className={j.vsPanel >= 0 ? "pos" : "neg"} style={{ width: `${(Math.abs(j.vsPanel) / maxLean) * 50}%` }} />
                </span>
                <span className={`kg-lean__n t-num ${j.vsPanel >= 0 ? "pos" : "neg"}`}>
                  {j.vsPanel >= 0 ? "+" : ""}
                  {j.vsPanel.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="kg-ins__note m0">Points above or below the panel's average, across every project.</p>
      </section>
      {stack.length > 0 && (
        <section>
          <h3>Shared stack</h3>
          <div className="kg-tags">
            {stack.map(([id, n]) => (
              <button key={id} type="button" className="kg-tag" onClick={() => onSelect(id)}>
                <span className="t-mono">{name(id)}</span> <b className="t-num">{n}</b>
              </button>
            ))}
          </div>
        </section>
      )}
      {tracks.length > 0 && (
        <section>
          <h3>Sponsor reach</h3>
          <ul className="m0">
            {tracks.map(([id, n]) => (
              <li key={id}>
                <button type="button" className="kg-row kg-reach" onClick={() => onSelect(id)}>
                  <span className="kg-reach__name">{name(id)}</span>
                  <span className="kg-reach__bar" aria-hidden="true">
                    <span style={{ width: `${(n / maxTrack) * 100}%` }} />
                  </span>
                  <span className="t-num kg-reach__n">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
