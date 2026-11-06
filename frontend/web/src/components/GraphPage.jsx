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
    <>
      <div className="intro">
        <h1 className="t-display-lg m0">
          <SplitWords>Knowledge graph</SplitWords>
        </h1>
        <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
          Every project, judge, track and dependency, and how they connect: who scored whom, who beat whom, and which projects build on the same stack.
        </p>
      </div>

      {state.loading ? (
        <div className="card kg-shell skeleton" style={{ minHeight: 560 }} aria-busy="true" />
      ) : state.error ? (
        <div className="card card--surface">
          <h2 className="t-heading m0">The graph is offline</h2>
          <p className="t-body m0 muted">We can't reach the backend right now. Try again in a minute.</p>
          {import.meta.env.DEV && <p className="t-mono-caption m0">Dev: cd backend && npm start</p>}
        </div>
      ) : !state.graph.nodes.length ? (
        <div className="card card--surface">
          <h2 className="t-heading m0">Nothing to connect yet</h2>
          <p className="t-body m0 muted">The graph fills in as projects are submitted, reviewed and judged.</p>
        </div>
      ) : (
        <motion.div className="kg-shell" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easeOut }}>
          <div className="kg-legend" role="group" aria-label="Show or hide node types">
            {Object.entries(NODE_TYPES).map(([t, meta]) => (
              <button key={t} type="button" className={`kg-toggle ${hidden.has(t) ? "is-off" : ""}`} aria-pressed={!hidden.has(t)} onClick={() => toggle(t)}>
                <span className={`kg-dot kg-dot--${t}`} aria-hidden="true" />
                {meta.label}
                <span className="t-num kg-toggle__n">{counts[t] ?? 0}</span>
              </button>
            ))}
            <span className="kg-legend__edges t-caption muted" aria-hidden="true">
              <i className="kg-line kg-line--scored" /> scored <i className="kg-line kg-line--beat" /> beat <i className="kg-line kg-line--uses" /> uses
            </span>
          </div>
          <div className="kg-stage">
            <GraphCanvas data={state.graph} hidden={hidden} selected={selected} onSelect={setSelected} />
            <AnimatePresence>
              {selected && (
                <motion.aside key={selected} className="kg-panel" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={bouncy}>
                  <button type="button" className="kg-close" onClick={() => setSelected(null)} aria-label="Close details">
                    ✕
                  </button>
                  <GraphDetails id={selected} data={state.graph} judges={state.judges} onSelect={setSelected} />
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
          <p className="t-caption muted m0">
            {state.graph.nodes.length} nodes · {state.graph.edges.length} links · {Object.values(REL_LABEL).join(", ")}
          </p>
        </motion.div>
      )}
    </>
  );
}
