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
import { Spinner } from "./Feedback.jsx";
import { LiveTest } from "./LiveTest.jsx";

const TALLY = [
  ["supported_by_code", "success", "supported by code"],
  ["contradicted", "danger", "contradicted"],
  ["unverified", "neutral", "unverified"],
  ["submitted_claim", "neutral", "can't check from code"],
];

const STEP_STATE = {
  queued: { tone: "neutral", word: "Queued" },
  running: { tone: "live", word: "Working" },
  done: { tone: "success", word: "✓ Done" },
  failed: { tone: "danger", word: "✕ Failed" },
  skipped: { tone: "neutral", word: "Skipped" },
};
const DEFAULT_STEPS = ["Fetch the repository", "Pin the commit", "Count the tests", "Read the demo video", "Build the evidence dossier", "Test the live app on cloud browsers", "Judges score it"].map((title, i) => ({ id: `s${i}`, title, status: "queued" }));

export function DossierPending({ project, state, running, review, offline, onRerun, rerunError }) {
  const steps = state?.steps ?? DEFAULT_STEPS;
  const failed = steps.some((s) => s.status === "failed");
  const done = Boolean(state?.finishedAt) && !running;
  const queued = review?.status === "queued";
  const head = offline
    ? { tone: "neutral", word: "Review service offline" }
    : queued
      ? { tone: "neutral", word: review.position ? `In the review queue · #${review.position}` : "In the review queue" }
      : running
        ? { tone: "live", word: "Reviewing now" }
        : failed
          ? { tone: "danger", word: "✕ Review stopped" }
          : done
            ? { tone: "neutral", word: "Review finished without a dossier" }
            : { tone: "neutral", word: "Waiting for the reviewer" };
  const busy = !offline && (queued || running);
  return (
    <div className="card stack">
      <div className="review-head">
        {busy && <Spinner size={22} label={head.word} />}
        <StatusPill tone={head.tone}>{head.word}</StatusPill>
      </div>
      <p className="t-body m0">
        {queued && review.ahead > 0
          ? `Reviews run one at a time. ${review.ahead} ${review.ahead === 1 ? "project is" : "projects are"} ahead of ${project.name}. `
          : ""}
        The reviewer fetches {project.name}'s repo, pins the commit and checks the team's claims against the code. Nothing from the repo is ever run.
      </p>
      <ol className="pending-steps">
        {steps.map((s, i) => {
          const st = STEP_STATE[s.status] ?? STEP_STATE.queued;
          return (
            <li key={s.id} className={`rise pending-steps__item pending-steps__item--${s.status}`} style={{ "--i": i }}>
              <span className="pending-steps__num t-num">{i + 1}</span>
              <span className="stack-xs pending-steps__text">
                <span className="t-body">{s.title}</span>
                {s.detail && <span className="t-caption">{s.detail}</span>}
              </span>
              <span className="pending-steps__state">
                {s.status === "running" && <Spinner size={16} label={`${s.title}: working`} />}
                <StatusPill tone={st.tone}>{st.word}</StatusPill>
              </span>
            </li>
          );
        })}
      </ol>
      {(failed || done) && onRerun && (
        <div className="judges__foot">
          {rerunError && <span className="field__error">✕ {rerunError}</span>}
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRerun}>
            Run the review again
          </button>
        </div>
      )}
    </div>
  );
}

/** For submitted projects: follow the backend pipeline live until the dossier exists. */
function useLiveDossier(project) {
  const [live, setLive] = useState({ dossier: project.dossier ?? null, state: null, running: false, review: null, offline: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (project.dossier || project.kind !== "submitted") return undefined;
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
      <h3 className="t-heading m0">{title}</h3>
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
  const [live, refresh] = useLiveDossier(project);
  const [rerunError, setRerunError] = useState("");
  const d = project.dossier ?? live.dossier;
  if (!d?.highlights) {
    const rerun = async () => {
      setRerunError("");
      try {
        await api(`/projects/${encodeURIComponent(project.id)}/pipeline`, { method: "POST" });
        refresh();
      } catch (e) {
        setRerunError(e.status === 401 || e.status === 403 ? "Needs the organizer key (set it on /judge)." : e.message);
      }
    };
    return (
      <>
        <DossierPending project={project} state={live.state} running={live.running} review={live.review} offline={live.offline} onRerun={project.kind === "submitted" ? rerun : undefined} rerunError={rerunError} />
        <LiveTest project={project} pending={live.running || live.review?.status === "queued"} />
      </>
    );
  }
  const h = d.highlights;
  const count = (s) => d.evidence.filter((e) => e.status === s).length;
  const c = d.continuity;
  const total = (c?.commitsBefore ?? 0) + (c?.commitsDuringEvent ?? 0);

  return (
    <div className="judge">
      <section className="card stack judge__verdict rise" style={{ "--i": 0 }} aria-label="Verdict">
        <span className="t-label">Verdict</span>
        <p className="t-prompt m0">{h.headline}</p>
        <div className="tally" aria-label={`${d.evidence.length} claims checked`}>
          {TALLY.filter(([s]) => count(s)).map(([s, tone, word]) => (
            <StatusPill key={s} tone={tone}>
              <span className="t-num">{count(s)}</span> {word}
            </StatusPill>
          ))}
        </div>
      </section>

      <LiveTest project={project} />

      <div className="judge__pair">
        <Findings title="What holds up" tone="good" items={h.holdsUp} i={1} />
        <Findings title="What to watch" tone="watch" items={h.watch} i={2} />
      </div>

      <div className="judge__pair">
        <section className="card stack rise" style={{ "--i": 3 }} aria-label="Tests">
          <div className="verdict__head">
            <span className="t-label">Tests</span>
            <StatusPill tone="neutral">{d.tests.status === "not_run" ? "Not run yet" : d.tests.status}</StatusPill>
          </div>
          <p className="m0">
            <span className="stat__value t-num">{d.tests.found.vitestCases.toLocaleString()}</span>{" "}
            <span className="t-body">JS/TS + {d.tests.found.forgeTests} Solidity tests found</span>
          </p>
          <span className="t-caption">{d.tests.claimed ? `Team says ${d.tests.claimed}. ` : ""}Counted from the code, not run.</span>
        </section>
        {c && (
          <section className="card stack rise" style={{ "--i": 4 }} aria-label="Built at the event">
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
