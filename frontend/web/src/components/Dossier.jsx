/*
 * "Agent judge" view: only the major findings.
 * The full dossier (every claim, refs, architecture, dependencies, questions)
 * stays stored on the project as project.dossier for later use (fight
 * generation, judge prompts). This view reads dossier.highlights plus two
 * numbers. Every status carries a word, never colour alone.
 */
import { Progress, StatusPill } from "@ds/ui.jsx";

const TALLY = [
  ["supported_by_code", "success", "supported by code"],
  ["contradicted", "danger", "contradicted"],
  ["unverified", "neutral", "unverified"],
  ["submitted_claim", "neutral", "can't check from code"],
];

export function DossierPending({ project }) {
  const steps = ["Fetch the repository", "Pin the commit", "Run the tests in a sandbox", "Build the evidence dossier"];
  return (
    <div className="card stack">
      <StatusPill tone="neutral">Waiting for the reviewer</StatusPill>
      <p className="t-body m0">The reviewer agent checks {project.name}'s claims against its code. The main findings show up here.</p>
      <ol className="pending-steps">
        {steps.map((s, i) => (
          <li key={s} className="rise" style={{ "--i": i }}>
            <span className="pending-steps__num t-num">{i + 1}</span>
            <span className="t-body">{s}</span>
            <StatusPill tone="neutral">Queued</StatusPill>
          </li>
        ))}
      </ol>
    </div>
  );
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
  const d = project.dossier;
  if (!d?.highlights) return <DossierPending project={project} />;
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
            <span className="t-body">vitest + {d.tests.found.forgeTests} forge found</span>
          </p>
          <span className="t-caption">Team says {d.tests.claimed}.</span>
        </section>
        {c && (
          <section className="card stack rise" style={{ "--i": 4 }} aria-label="Built at the event">
            <span className="t-label">Built at the event</span>
            <p className="m0">
              <span className="stat__value t-num">{c.commitsDuringEvent}</span> <span className="t-body">of {total} commits</span>
            </p>
            <Progress value={c.commitsDuringEvent} max={total || 1} label="Commits made during the event" />
            <span className="t-caption">Earlier work ends at commit {c.boundaryCommit}.</span>
          </section>
        )}
      </div>

      <p className="t-mono-caption m0">
        {d.reviewer.name} · {d.evidence.length} claims checked at {d.commit.slice(0, 7)} · full findings stored with the project
      </p>
    </div>
  );
}
