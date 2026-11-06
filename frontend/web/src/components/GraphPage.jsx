/*
 * /graph: the knowledge graph as a canvas you can pan, zoom and drag.
 * Projects, judges, tracks and tech are nodes; scores, fights, tracks and
 * dependencies are edges. Click a node to see what the graph knows about it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SplitWords, bouncy, easeOut } from "./fx.jsx";
import { api } from "../lib/api.js";
import { Link } from "../lib/router.jsx";
import { NODE_TYPES, createSimulation, hitTest, neighbourhood, prepareGraph, reheat, tick, visibleGraph } from "../lib/graphLayout.js";

const REL_LABEL = { SCORED: "scored", BEAT: "beat", IN_TRACK: "in track", USES: "uses" };

/** Colours come from the design-system tokens, read once from CSS. */
function readPalette(el) {
  const css = getComputedStyle(el);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    ground: v("--canvas"),
    dot: v("--grid-dot"),
    dotStrong: v("--world-ground-dot-strong") || v("--line-strong"),
    ink: v("--ink"),
    inkSoft: v("--ink-secondary"),
    line: v("--line-strong"),
    halo: v("--canvas"),
    project: { fill: v("--crush"), soft: v("--crush-soft"), text: v("--ink") },
    judge: { fill: v("--oracle"), soft: v("--oracle-soft"), text: v("--on-oracle") },
    track: { fill: v("--success"), soft: v("--success-soft"), text: v("--on-oracle") },
    tech: { fill: v("--sunny"), soft: v("--sunny-soft"), text: v("--ink") },
    edge: { SCORED: v("--oracle"), BEAT: v("--crush-ink"), IN_TRACK: v("--success"), USES: v("--line-strong") },
    font: v("--font-sans") || "system-ui",
    mono: v("--font-mono") || "monospace",
  };
}

const initials = (s) =>
  String(s)
    .replace(/^@/, "")
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function GraphCanvas({ data, hidden, selected, onSelect }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const sim = useRef(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef(null);
  const drag = useRef(null);
  const size = useRef({ w: 800, h: 560 });
  const palette = useRef(null);
  const raf = useRef(0);
  const fitted = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [tip, setTip] = useState(null);

  const graph = useMemo(() => visibleGraph(data, hidden), [data, hidden]);

  const animateTo = useCallback((target) => {
    const from = { ...view.current };
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 500);
      const e = 1 - (1 - p) ** 3;
      view.current = { k: from.k + (target.k - from.k) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const fit = useCallback((animate = true) => {
    const s = sim.current;
    if (!s?.nodes.length) return;
    const { w, h } = size.current;
    const xs = s.nodes.map((n) => [n.x - n.r, n.x + n.r]).flat();
    const ys = s.nodes.map((n) => [n.y - n.r, n.y + n.r]).flat();
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(1.6, Math.max(0.25, Math.min((w - 120) / (x1 - x0 || 1), (h - 120) / (y1 - y0 || 1))));
    const target = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    if (!animate) return (view.current = target);
    animateTo(target);
  }, [animateTo]);

  // Selecting a node glides it into the part of the canvas the details panel doesn't cover.
  useEffect(() => {
    const n = selected && sim.current?.byId.get(selected);
    if (!n) return;
    const { w, h } = size.current;
    const panel = w > 860 ? 380 : 0;
    const k = view.current.k;
    animateTo({ k, x: (w - panel) / 2 - n.x * k, y: h / 2 - n.y * k });
  }, [selected, animateTo]);

  const zoomBy = useCallback((f, cx, cy) => {
    const v = view.current;
    const { w, h } = size.current;
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    const k = Math.min(4, Math.max(0.2, v.k * f));
    view.current = { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
  }, []);

  // (Re)build the simulation when the visible graph changes; keep positions of nodes that stay.
  useEffect(() => {
    const prev = sim.current?.byId;
    const s = prepareGraph(graph, { width: size.current.w, height: size.current.h });
    if (prev) {
      for (const n of s.nodes) {
        const o = prev.get(n.id);
        if (o) Object.assign(n, { x: o.x, y: o.y });
      }
    }
    createSimulation(s, { width: size.current.w, height: size.current.h });
    if (prev) reheat(s, 0.5);
    else {
      for (let i = 0; i < 300 && tick(s) > 0; i++);
      fitted.current = false; // fit once the canvas has its real size
    }
    sim.current?.force?.stop();
    sim.current = s;
  }, [graph]);

  // Size + DPR.
  useEffect(() => {
    const el = wrap.current;
    palette.current = readPalette(el);
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      // A real resize (rotation, window change) refits; the first measurement fits too.
      if (Math.abs(width - size.current.w) > 40 || !size.current.ready) fitted.current = false;
      size.current = { w: width, h: height, ready: width > 0 };
      const dpr = window.devicePixelRatio || 1;
      canvas.current.width = Math.round(width * dpr);
      canvas.current.height = Math.round(height * dpr);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render loop.
  useEffect(() => {
    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const s = sim.current;
      const c = canvas.current;
      const P = palette.current;
      if (!s || !c || !P) return;
      const { w, h } = size.current;
      tick(s, { pinned: drag.current?.node ?? null });
      if (!fitted.current && size.current.ready) {
        fitted.current = true;
        fit(false);
      }
      const ctx = c.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const { x: vx, y: vy, k } = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = P.ground;
      ctx.fillRect(0, 0, w, h);

      // Dotted canvas grid that pans and zooms with the graph.
      const gap = 24 * k;
      if (gap > 6) {
        ctx.fillStyle = P.dotStrong;
        const ox = ((vx % gap) + gap) % gap;
        const oy = ((vy % gap) + gap) % gap;
        const rr = Math.max(1.2, 1.8 * Math.min(k, 1.4));
        for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) ctx.fillRect(x - rr / 2, y - rr / 2, rr, rr);
      }

      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * vx, dpr * vy);
      const focus = hover.current?.id ?? selectedRef.current;
      const near = focus && s.byId.has(focus) ? neighbourhood(s, focus) : null;
      const lit = (id) => !near || near.has(id);

      // Edges: soft curves; fights get an arrow.
      for (const l of s.links) {
        const on = !near || (near.has(l.source.id) && near.has(l.target.id) && (l.source.id === focus || l.target.id === focus));
        const { x: x1, y: y1 } = l.source;
        const { x: x2, y: y2 } = l.target;
        const mx = (x1 + x2) / 2 - (y2 - y1) * 0.12;
        const my = (y1 + y2) / 2 + (x2 - x1) * 0.12;
        ctx.globalAlpha = on ? (l.rel === "USES" ? 0.55 : 0.85) : 0.08;
        ctx.strokeStyle = P.edge[l.rel] ?? P.line;
        ctx.lineWidth = (l.rel === "BEAT" ? 2.6 : l.rel === "SCORED" ? 1.4 + (l.score ?? 50) / 50 : 1.2) / Math.sqrt(k);
        ctx.setLineDash(l.rel === "USES" ? [3, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (l.rel === "BEAT" && on) {
          const ang = Math.atan2(y2 - my, x2 - mx);
          const ax = x2 - Math.cos(ang) * (l.target.r + 4);
          const ay = y2 - Math.sin(ang) * (l.target.r + 4);
          ctx.fillStyle = P.edge.BEAT;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - Math.cos(ang - 0.45) * 10, ay - Math.sin(ang - 0.45) * 10);
          ctx.lineTo(ax - Math.cos(ang + 0.45) * 10, ay - Math.sin(ang + 0.45) * 10);
          ctx.fill();
        }
        // Score chip on the edge when it's in focus.
        if (near && on && l.rel === "SCORED" && l.score != null) {
          const tx = (x1 + 2 * mx + x2) / 4;
          const ty = (y1 + 2 * my + y2) / 4;
          const label = l.score.toFixed(1);
          ctx.font = `700 ${11 / Math.sqrt(k)}px ${P.mono}`;
          const tw = ctx.measureText(label).width + 10 / Math.sqrt(k);
          const th = 18 / Math.sqrt(k);
          ctx.globalAlpha = 1;
          ctx.fillStyle = P.judge.fill;
          ctx.beginPath();
          ctx.roundRect(tx - tw / 2, ty - th / 2, tw, th, th / 2);
          ctx.fill();
          ctx.fillStyle = P.judge.text;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, tx, ty + 0.5);
        }
      }
      ctx.globalAlpha = 1;

      // Nodes.
      for (const n of s.nodes) {
        const c2 = P[n.type] ?? P.tech;
        const on = lit(n.id);
        const isSel = n.id === selectedRef.current;
        const isHover = n.id === hover.current?.id;
        ctx.globalAlpha = on ? 1 : 0.18;
        // Soft halo for hubs and focus.
        if (on && (isSel || isHover || n.type === "project" || n.type === "judge")) {
          ctx.fillStyle = c2.soft;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + (isSel || isHover ? 10 : 6), 0, Math.PI * 2);
          ctx.fill();
        }
        // Sticker look: ink offset shadow + ink outline.
        if (n.type === "project" || n.type === "judge") {
          ctx.fillStyle = P.ink;
          ctx.beginPath();
          ctx.arc(n.x, n.y + 3, n.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = c2.fill;
        ctx.strokeStyle = P.ink;
        ctx.lineWidth = n.type === "tech" ? 1.2 : 2;
        ctx.beginPath();
        if (n.type === "track") {
          const r = n.r;
          ctx.roundRect(n.x - r, n.y - r, r * 2, r * 2, r * 0.45);
        } else ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (n.type !== "tech") {
          ctx.fillStyle = c2.text;
          ctx.font = `800 ${Math.round(n.r * 0.72)}px ${P.font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(initials(n.label), n.x, n.y + 1);
        }
        // Labels: hubs always, tech when zoomed in or in focus.
        const showLabel = n.type !== "tech" || k > 1.1 || s.nodes.length < 60 || (near && near.has(n.id));
        if (showLabel && on) {
          const fs = (n.type === "tech" ? 11 : 13) / Math.sqrt(k);
          ctx.font = `${n.type === "tech" ? 500 : 700} ${fs}px ${n.type === "tech" ? P.mono : P.font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const text = n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label;
          const ty = n.y + n.r + (n.type === "project" || n.type === "judge" ? 9 : 6);
          ctx.lineWidth = 4 / Math.sqrt(k);
          ctx.strokeStyle = P.halo;
          ctx.lineJoin = "round";
          ctx.strokeText(text, n.x, ty);
          ctx.fillStyle = n.type === "tech" ? P.inkSoft : P.ink;
          ctx.fillText(text, n.x, ty);
        }
      }
      ctx.globalAlpha = 1;
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [fit]);

  // Pointer: drag nodes, pan the canvas, hover, click.
  const toGraph = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const { x, y, k } = view.current;
    return { sx, sy, gx: (sx - x) / k, gy: (sy - y) / k };
  };
  const onDown = (e) => {
    const p = toGraph(e);
    const n = sim.current && hitTest(sim.current, p.gx, p.gy);
    canvas.current.setPointerCapture(e.pointerId);
    drag.current = n ? { node: n, moved: false, ...p } : { pan: true, moved: false, ...p, vx: view.current.x, vy: view.current.y };
  };
  const onMove = (e) => {
    const p = toGraph(e);
    const d = drag.current;
    if (d) {
      if (Math.abs(p.sx - d.sx) + Math.abs(p.sy - d.sy) > 3) d.moved = true;
      if (d.node) {
        d.node.x = p.gx;
        d.node.y = p.gy;
        reheat(sim.current, 0.25);
      } else if (d.pan) {
        view.current = { ...view.current, x: d.vx + (p.sx - d.sx), y: d.vy + (p.sy - d.sy) };
      }
      return;
    }
    const n = sim.current && hitTest(sim.current, p.gx, p.gy);
    hover.current = n;
    canvas.current.style.cursor = n ? "pointer" : "grab";
    setTip(n ? { x: p.sx, y: p.sy, node: n } : null);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onSelect(d.node ? d.node.id : null);
  };
  useEffect(() => {
    const c = canvas.current;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  return (
    <div className="kg-canvas" ref={wrap}>
      <canvas
        ref={canvas}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          hover.current = null;
          setTip(null);
        }}
        role="img"
        aria-label={`Knowledge graph with ${graph.nodes.length} nodes and ${graph.edges.length} links`}
      />
      <div className="kg-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => fit(true)} aria-label="Fit to view" title="Fit to view">
          ⤢
        </button>
      </div>
      <p className="kg-hint t-caption">Drag to pan · scroll to zoom · drag a node · click for details</p>
      {tip && (
        <div className="kg-tip" style={{ left: tip.x, top: tip.y }}>
          <span className={`kg-dot kg-dot--${tip.node.type}`} aria-hidden="true" />
          <strong>{tip.node.label}</strong>
          <span className="t-caption muted">
            {tip.node.type} · {tip.node.degree} link{tip.node.degree === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={`kg-stat ${tone ? `kg-stat--${tone}` : ""}`}>
      <span className="t-caption muted">{label}</span>
      <strong className="t-num">{value ?? "—"}</strong>
    </div>
  );
}

function Details({ id, data, judges, onSelect }) {
  const node = data.nodes.find((n) => n.id === id);
  const [info, setInfo] = useState(null);
  const type = node?.type;
  const key = id?.split(":").slice(1).join(":");

  useEffect(() => {
    setInfo(null);
    if (type !== "project") return;
    let live = true;
    Promise.all([api(`/graph/projects/${encodeURIComponent(key)}`), api(`/graph/projects/${encodeURIComponent(key)}/similar`)])
      .then(([explain, similar]) => live && setInfo({ explain, similar }))
      .catch(() => live && setInfo({ error: true }));
    return () => {
      live = false;
    };
  }, [type, key]);

  if (!node) return null;
  const name = node.name || key;
  const linked = (rel, dir) =>
    data.edges
      .filter((e) => e.rel === rel && (dir === "out" ? e.from === id : e.to === id))
      .map((e) => ({ ...e, other: data.nodes.find((n) => n.id === (dir === "out" ? e.to : e.from)) }))
      .filter((e) => e.other);
  const NodeChip = ({ n, extra }) => (
    <button type="button" className="kg-chip" onClick={() => onSelect(n.id)}>
      <span className={`kg-dot kg-dot--${n.type}`} aria-hidden="true" />
      {n.name || n.id.split(":").slice(1).join(":")}
      {extra != null && <span className="t-num kg-chip__extra">{extra}</span>}
    </button>
  );

  return (
    <div className="kg-detail">
      <div className="kg-detail__head">
        <span className={`kg-badge kg-badge--${type}`}>{type}</span>
        <h2 className="t-heading m0">{name}</h2>
        {type === "project" && (
          <Link className="t-caption kg-link" to={`/projects/${encodeURIComponent(key)}`}>
            Open project →
          </Link>
        )}
      </div>

      {type === "project" &&
        (info?.explain ? (
          <>
            <div className="kg-stats">
              <Stat label="Panel avg" value={info.explain.panelAvg?.toFixed(1)} tone="oracle" />
              <Stat label="Supported" value={info.explain.claims.supported} tone="success" />
              <Stat label="Contradicted" value={info.explain.claims.contradicted} tone="danger" />
            </div>
            {info.explain.scores.length > 0 && (
              <section>
                <h3 className="kg-h">Judges</h3>
                <div className="kg-chips">
                  {info.explain.scores.map((s) => (
                    <NodeChip key={s.judgeId} n={{ id: `judge:${s.judgeId}`, type: "judge", name: s.name }} extra={s.score.toFixed(1)} />
                  ))}
                </div>
              </section>
            )}
            {info.explain.contradicted.length > 0 && (
              <section>
                <h3 className="kg-h">Contradicted claims</h3>
                <ul className="kg-list">
                  {info.explain.contradicted.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>
            )}
            {(info.explain.beat.length > 0 || info.explain.lostTo.length > 0) && (
              <section>
                <h3 className="kg-h">Fights</h3>
                <div className="kg-chips">
                  {info.explain.beat.map((p) => (
                    <NodeChip key={`b${p}`} n={data.nodes.find((n) => n.id === `project:${p}`) ?? { id: `project:${p}`, type: "project" }} extra="won" />
                  ))}
                  {info.explain.lostTo.map((p) => (
                    <NodeChip key={`l${p}`} n={data.nodes.find((n) => n.id === `project:${p}`) ?? { id: `project:${p}`, type: "project" }} extra="lost" />
                  ))}
                </div>
              </section>
            )}
            <section>
              <h3 className="kg-h">Similar projects</h3>
              {info.similar.length ? (
                <div className="kg-chips">
                  {info.similar.map((s) => (
                    <NodeChip key={s.projectId} n={{ id: `project:${s.projectId}`, type: "project", name: s.name }} extra={`${Math.round(s.similarity * 100)}%`} />
                  ))}
                </div>
              ) : (
                <p className="t-caption muted m0">No other project shares its tech or tracks yet.</p>
              )}
            </section>
            {info.explain.tech.length > 0 && (
              <section>
                <h3 className="kg-h">Tech</h3>
                <div className="kg-chips">
                  {info.explain.tech.map((t) => (
                    <NodeChip key={t} n={{ id: `tech:${t}`, type: "tech", name: t }} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : info?.error ? (
          <p className="t-caption muted m0">Couldn't load this project's details.</p>
        ) : (
          <div className="kg-skeleton skeleton" />
        ))}

      {type === "judge" &&
        (() => {
          const j = judges.find((x) => `judge:${x.judgeId}` === id);
          const scored = linked("SCORED", "out");
          return (
            <>
              <div className="kg-stats">
                <Stat label="Average" value={j?.avg?.toFixed(1)} tone="oracle" />
                <Stat label="vs panel" value={j?.vsPanel == null ? null : `${j.vsPanel > 0 ? "+" : ""}${j.vsPanel.toFixed(1)}`} tone={j?.vsPanel > 0 ? "success" : j?.vsPanel < 0 ? "danger" : undefined} />
                <Stat label="Scored" value={scored.length} />
              </div>
              <p className="t-caption muted m0">{j?.vsPanel == null ? "No scores yet." : j.vsPanel > 0 ? "Scores above the panel average: more generous." : j.vsPanel < 0 ? "Scores below the panel average: tougher." : "Right on the panel average."}</p>
              {scored.length > 0 && (
                <section>
                  <h3 className="kg-h">Projects scored</h3>
                  <div className="kg-chips">
                    {scored.map((e) => (
                      <NodeChip key={e.to} n={e.other} extra={e.score?.toFixed(1)} />
                    ))}
                  </div>
                </section>
              )}
            </>
          );
        })()}

      {(type === "tech" || type === "track") &&
        (() => {
          const projects = linked(type === "tech" ? "USES" : "IN_TRACK", "in");
          return (
            <section>
              <h3 className="kg-h">
                {projects.length} project{projects.length === 1 ? "" : "s"} {type === "tech" ? "use this" : "in this track"}
              </h3>
              <div className="kg-chips">
                {projects.map((e) => (
                  <NodeChip key={e.from} n={e.other} />
                ))}
              </div>
            </section>
          );
        })()}
    </div>
  );
}

export function GraphPage() {
  const [state, setState] = useState({ loading: true });
  const [hidden, setHidden] = useState(() => new Set());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([api("/graph"), api("/graph/judges")])
      .then(([graph, judges]) => setState({ graph, judges }))
      .catch((e) => setState({ error: e.message }));
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
                  <Details id={selected} data={state.graph} judges={state.judges} onSelect={setSelected} />
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
