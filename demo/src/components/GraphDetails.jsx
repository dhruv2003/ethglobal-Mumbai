/* The knowledge graph's side panel: what the graph knows about the selected node. */
import { useEffect, useState } from "react";
import { api, peekApi } from "../lib/api.js";
import { Link } from "../lib/router.jsx";

function Stat({ label, value, tone }) {
  return (
    <div className={`kg-stat ${tone ? `kg-stat--${tone}` : ""}`}>
      <span className="t-caption muted">{label}</span>
      <strong className="t-num">{value ?? "—"}</strong>
    </div>
  );
}

/** A node you can jump to, with an optional number or word beside it. */
function NodeChip({ n, extra, onSelect }) {
  return (
    <button type="button" className="kg-chip" onClick={() => onSelect(n.id)}>
      <span className={`kg-dot kg-dot--${n.type}`} aria-hidden="true" />
      {n.name || n.id.split(":").slice(1).join(":")}
      {extra != null && <span className="t-num kg-chip__extra">{extra}</span>}
    </button>
  );
}

/** Edges of one kind leaving (`out`) or reaching (`in`) a node, each with the node at the other end. */
function linked(data, id, rel, dir) {
  return data.edges
    .filter((e) => e.rel === rel && (dir === "out" ? e.from === id : e.to === id))
    .map((e) => ({ ...e, other: data.nodes.find((n) => n.id === (dir === "out" ? e.to : e.from)) }))
    .filter((e) => e.other);
}

function ProjectDetails({ info, data, onSelect }) {
  if (info?.error) return <p className="t-caption muted m0">Couldn't load this project's details.</p>;
  if (!info?.explain) return <div className="kg-skeleton skeleton" />;
  const { explain, similar } = info;
  const projectNode = (p) => data.nodes.find((n) => n.id === `project:${p}`) ?? { id: `project:${p}`, type: "project" };
  return (
    <>
      <div className="kg-stats">
        <Stat label="Panel avg" value={explain.panelAvg?.toFixed(1)} tone="oracle" />
        <Stat label="Supported" value={explain.claims.supported} tone="success" />
        <Stat label="Contradicted" value={explain.claims.contradicted} tone="danger" />
      </div>
      {explain.scores.length > 0 && (
        <section>
          <h3 className="kg-h">Judges</h3>
          <div className="kg-chips">
            {explain.scores.map((s) => (
              <NodeChip key={s.judgeId} n={{ id: `judge:${s.judgeId}`, type: "judge", name: s.name }} extra={s.score.toFixed(1)} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
      {explain.contradicted.length > 0 && (
        <section>
          <h3 className="kg-h">Contradicted claims</h3>
          <ul className="kg-list">
            {explain.contradicted.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      {(explain.beat.length > 0 || explain.lostTo.length > 0) && (
        <section>
          <h3 className="kg-h">Fights</h3>
          <div className="kg-chips">
            {explain.beat.map((p) => (
              <NodeChip key={`b${p}`} n={projectNode(p)} extra="won" onSelect={onSelect} />
            ))}
            {explain.lostTo.map((p) => (
              <NodeChip key={`l${p}`} n={projectNode(p)} extra="lost" onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="kg-h">Similar projects</h3>
        {similar.length ? (
          <div className="kg-chips">
            {similar.map((s) => (
              <NodeChip key={s.projectId} n={{ id: `project:${s.projectId}`, type: "project", name: s.name }} extra={`${Math.round(s.similarity * 100)}%`} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <p className="t-caption muted m0">No other project shares its tech or tracks yet.</p>
        )}
      </section>
      {explain.tech.length > 0 && (
        <section>
          <h3 className="kg-h">Tech</h3>
          <div className="kg-chips">
            {explain.tech.map((t) => (
              <NodeChip key={t} n={{ id: `tech:${t}`, type: "tech", name: t }} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function JudgeDetails({ id, data, judges, onSelect }) {
  const j = judges.find((x) => `judge:${x.judgeId}` === id);
  const scored = linked(data, id, "SCORED", "out");
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
              <NodeChip key={e.to} n={e.other} extra={e.score?.toFixed(1)} onSelect={onSelect} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** Tech and tracks: the projects that use or entered them. */
function LinkedProjects({ id, type, data, onSelect }) {
  const projects = linked(data, id, type === "tech" ? "USES" : "IN_TRACK", "in");
  return (
    <section>
      <h3 className="kg-h">
        {projects.length} project{projects.length === 1 ? "" : "s"} {type === "tech" ? "use this" : "in this track"}
      </h3>
      <div className="kg-chips">
        {projects.map((e) => (
          <NodeChip key={e.from} n={e.other} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

export function GraphDetails({ id, data, judges, onSelect }) {
  const node = data.nodes.find((n) => n.id === id);
  const type = node?.type;
  const key = id?.split(":").slice(1).join(":");
  const cachedInfo = () => {
    const explain = peekApi(`/graph/projects/${encodeURIComponent(key)}`);
    const similar = peekApi(`/graph/projects/${encodeURIComponent(key)}/similar`);
    return explain && similar ? { explain, similar } : null;
  };
  const [info, setInfo] = useState(() => (type === "project" ? cachedInfo() : null));

  useEffect(() => {
    setInfo(type === "project" ? cachedInfo() : null);
    if (type !== "project") return;
    let live = true;
    Promise.all([api(`/graph/projects/${encodeURIComponent(key)}`), api(`/graph/projects/${encodeURIComponent(key)}/similar`)])
      .then(([explain, similar]) => live && setInfo({ explain, similar }))
      .catch(() => live && setInfo((i) => (i && !i.error ? i : { error: true })));
    return () => {
      live = false;
    };
  }, [type, key]);

  if (!node) return null;
  return (
    <div className="kg-detail">
      <div className="kg-detail__head">
        <span className={`kg-badge kg-badge--${type}`}>{type}</span>
        <h2 className="t-heading m0">{node.name || key}</h2>
        {type === "project" && (
          <Link className="t-caption kg-link" to={`/projects/${encodeURIComponent(key)}`}>
            Open project →
          </Link>
        )}
      </div>
      {type === "project" && <ProjectDetails info={info} data={data} onSelect={onSelect} />}
      {type === "judge" && <JudgeDetails id={id} data={data} judges={judges} onSelect={onSelect} />}
      {(type === "tech" || type === "track") && <LinkedProjects id={id} type={type} data={data} onSelect={onSelect} />}
    </div>
  );
}
