/*
 * "Agent judge" view: only the major findings.
 * The full dossier (every claim, refs, architecture, dependencies, questions)
 * stays stored on the project as project.dossier for later use (fight
 * generation, judge prompts). This view reads dossier.highlights plus two
 * numbers. Every status carries a word, never colour alone.
 */
import { useEffect, useState } from "react";
import { Progress, StatusPill } from "@ds/ui.jsx";
import { api, health } from "../lib/api.js";
import { LiveTest } from "./LiveTest.jsx";


/** For submitted projects: follow the backend pipeline live until the dossier exists. */
function useLiveDossier(project) {
  const [live, setLive] = useState({ dossier: project.dossier ?? null, state: null, running: false, review: null, offline: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (project.kind !== "submitted") return undefined;
    let alive = true;
    let timer;
    const started = Date.now();
    const load = async () => {
      const h = await health();
      if (!h) return alive && setLive((l) => ({ ...l, offline: true }));
      const id = encodeURIComponent(project.id);
      const [p, d] = await Promise.all([api(`/projects/${id}/pipeline`).catch(() => null), api(`/projects/${id}/dossier`).catch(() => null)]);
      if (!alive) return;
      const running = Boolean(p?.running) || (!p?.state && Date.now() - Date.parse(project.submittedAt ?? 0) < 5 * 60 * 1000);
      setLive({ dossier: d?.dossier ?? null, state: p?.state ?? null, running, review: p?.review ?? null, offline: false });
      const waiting = running || p?.review?.status === "queued" || (p?.state && !p.state.finishedAt);
      if (waiting && Date.now() - started < 30 * 60 * 1000) timer = setTimeout(load, 3000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [project.id, project.dossier, project.kind, project.submittedAt, tick]);
  return [live, () => setTick((t) => t + 1)];
}

function Findings({ title, tone, items, i }) {
  return (
    <section className={`card stack findings findings--${tone} rise`} style={{ "--i": i }}>
      <h3 className="findings__title m0">
        <span className="findings__badge" aria-hidden="true">
          {tone === "good" ? "✓" : "!"}
        </span>
        {title}
        <span className="findings__n t-num">{items.length}</span>
      </h3>
      <ul className="findings__list">
        {items.map((x) => (
          <li key={x.text} className="t-body">
            {x.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Dossier({ project }) {
  const [live] = useLiveDossier(project);
  const d = project.dossier ?? live.dossier;
  // No fact-check yet (or it couldn't run): the pipeline view above says why.
  if (!d?.highlights) return <LiveTest project={project} pending={live.running || live.review?.status === "queued"} />;
  const h = d.highlights;
  const c = d.continuity;
  const total = (c?.commitsBefore ?? 0) + (c?.commitsDuringEvent ?? 0);

  return (
    <div className="judge">
      <LiveTest project={project} />

      <div className="sect-head">
        <span className="t-label">What the fact-check found</span>
        <span className="t-caption">
          {d.evidence.length} claims checked against the code at {d.commit.slice(0, 7)}
        </span>
      </div>
      <div className="judge__pair">
        <Findings title="What holds up" tone="good" items={h.holdsUp} i={1} />
        <Findings title="What to watch" tone="watch" items={h.watch} i={2} />
      </div>

      <div className="judge__pair">
        <section className="card stack ftile ftile--oracle rise" style={{ "--i": 3 }} aria-label="Tests">
          <div className="verdict__head">
            <span className="t-label">Tests</span>
            <StatusPill tone="neutral">{d.tests.status === "not_run" ? "Not run yet" : d.tests.status}</StatusPill>
          </div>
          <p className="m0">
            <span className="stat__value t-num">{d.tests.found.vitestCases.toLocaleString()}</span>{" "}
            <span className="t-body">
              JS/TS + {d.tests.found.forgeTests} Solidity{d.tests.found.pyTests ? ` + ${d.tests.found.pyTests} Python` : ""} tests found
            </span>
          </p>
          <span className="t-caption">{d.tests.claimed ? `Team says ${d.tests.claimed}. ` : ""}Counted from the code, not run.</span>
        </section>
        {c && (
          <section className="card stack ftile ftile--sunny rise" style={{ "--i": 4 }} aria-label="Built at the event">
            <span className="t-label">Built at the event</span>
            <p className="m0">
              <span className="stat__value t-num">{c.commitsDuringEvent}</span> <span className="t-body">of {total} commits</span>
            </p>
            <Progress value={c.commitsDuringEvent} max={total || 1} label="Commits made during the event" />
            <span className="t-caption">{c.boundaryCommit ? `Earlier work ends at commit ${c.boundaryCommit}.` : `Counted from ${c.boundaryLabel ?? "the event start"}${c.historyTruncated ? "; only recent history was fetched" : ""}.`}</span>
          </section>
        )}
      </div>

      <p className="t-mono-caption m0">
        {d.reviewer.name} · {d.evidence.length} claims checked at {d.commit.slice(0, 7)} · full findings stored with the project
      </p>
    </div>
  );
}
