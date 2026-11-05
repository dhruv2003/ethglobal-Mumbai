/*
 * Right-hand column of a project page: what the reviewer agent found.
 * Structure follows PRD EVD-04/05. Every status carries a word (never colour alone).
 */
import { useState } from "react";
import { Progress, StatusPill } from "@ds/ui.jsx";

export const EVIDENCE_STATUS = {
  supported_by_code: { tone: "success", word: "✓ Supported by code", short: "supported" },
  contradicted: { tone: "danger", word: "✕ Contradicted", short: "contradicted" },
  unverified: { tone: "neutral", word: "? Unverified", short: "unverified" },
  submitted_claim: { tone: "neutral", word: "Team's claim", short: "claims only" },
};
const ORDER = ["supported_by_code", "contradicted", "unverified", "submitted_claim"];

/** "app/x.ts:12" -> link to that line at the pinned commit. */
function RefLink({ refStr, repoUrl, commit }) {
  const m = String(refStr).match(/^(.*?)(?::(\d+))?$/);
  const path = m?.[1] ?? refStr;
  const line = m?.[2];
  const href = repoUrl && commit ? `${repoUrl}/blob/${commit}/${path}${line ? `#L${line}` : ""}` : null;
  return href ? (
    <a className="t-mono-caption ref" href={href} target="_blank" rel="noreferrer">
      {refStr}
    </a>
  ) : (
    <span className="t-mono-caption ref">{refStr}</span>
  );
}

function List({ items }) {
  return (
    <ul className="dossier-list">
      {items.map((x) => (
        <li key={x} className="t-body">
          {x}
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children, open = false, count }) {
  return (
    <details className="card dossier-block" open={open}>
      <summary>
        <span className="t-heading">{title}</span>
        {count != null && <span className="t-caption t-num">{count}</span>}
      </summary>
      <div className="dossier-block__body">{children}</div>
    </details>
  );
}

export function DossierPending({ project }) {
  const steps = ["Fetch the repository", "Pin the commit", "Run the tests in a sandbox", "Build the evidence dossier"];
  return (
    <div className="stack">
      <div className="card stack">
        <StatusPill tone="neutral">Waiting for the reviewer</StatusPill>
        <p className="t-body m0">
          The reviewer agent reads {project.name}'s repo, demo and description, checks each claim against the code, and writes its findings here.
        </p>
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
    </div>
  );
}

export function Dossier({ project }) {
  const d = project.dossier;
  const [filter, setFilter] = useState("all");
  if (!d) return <DossierPending project={project} />;

  const counts = Object.fromEntries(ORDER.map((s) => [s, d.evidence.filter((e) => e.status === s).length]));
  const total = d.evidence.length;
  const shown = filter === "all" ? d.evidence : d.evidence.filter((e) => e.status === filter);
  const ref = (r) => <RefLink key={r} refStr={r} repoUrl={project.repoUrl} commit={d.commit} />;
  const c = d.continuity;
  const totalCommits = (c?.commitsBefore ?? 0) + (c?.commitsDuringEvent ?? 0);

  return (
    <div className="dossier">
      <div className="dossier__main">
      <section className="card stack verdict rise" style={{ "--i": 0 }} aria-labelledby="verdict-h">
        <div className="verdict__head">
          <h3 id="verdict-h" className="t-heading m0">Summary</h3>
          <span className="t-mono-caption">at {d.commit.slice(0, 7)}</span>
        </div>
        <p className="t-body m0">{d.summary}</p>
        <div className="verdict__call">
          <span className="t-label">Verdict</span>
          <p className="t-body-strong m0">{d.verdict}</p>
        </div>
        <div className="tally" aria-label="Evidence by status">
          {ORDER.filter((s) => counts[s]).map((s) => (
            <StatusPill key={s} tone={EVIDENCE_STATUS[s].tone}>
              <span className="t-num">{counts[s]}</span> {EVIDENCE_STATUS[s].short}
            </StatusPill>
          ))}
        </div>
      </section>

      <section className="card stack rise" style={{ "--i": 1 }} aria-labelledby="evidence-h">
        <div className="verdict__head">
          <h3 id="evidence-h" className="t-heading m0">Claims checked</h3>
          <span className="t-caption t-num">
            {shown.length} of {total}
          </span>
        </div>
        <div className="chips" role="group" aria-label="Filter claims">
          <button type="button" className="chip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All
          </button>
          {ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
              {EVIDENCE_STATUS[s].word.replace(/^[✓✕?] /, "")} <span className="chip__count t-num">{counts[s]}</span>
            </button>
          ))}
        </div>
        <ul className="evidence" key={filter}>
          {shown.map((e, i) => (
            <li key={e.id} className="evidence__item rise" style={{ "--i": Math.min(i, 6) }}>
              <details>
                <summary>
                  <StatusPill tone={EVIDENCE_STATUS[e.status]?.tone ?? "neutral"}>{EVIDENCE_STATUS[e.status]?.word ?? e.status}</StatusPill>
                  <span className="t-body-strong evidence__claim">{e.claim}</span>
                </summary>
                <div className="evidence__body">
                  <p className="t-body m0">{e.observation}</p>
                  {e.limitations && <p className="t-caption m0">Limits: {e.limitations}</p>}
                  <div className="evidence__meta">
                    <span className="t-caption">From the {e.source}</span>
                    {e.refs?.length > 0 && <div className="refs">{e.refs.map(ref)}</div>}
                  </div>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <Block title="Strengths" count={d.strengths.length} open>
        <List items={d.strengths} />
      </Block>
      <Block title="Risks and limitations" count={d.risks.length + d.limitations.length}>
        <List items={[...d.risks, ...d.limitations]} />
      </Block>
      <Block title="Questions for the judges" count={d.unresolvedQuestions.length}>
        <List items={d.unresolvedQuestions} />
      </Block>
      </div>

      <aside className="dossier__side" aria-label="Numbers and context">
      <section className="card stack rise" style={{ "--i": 2 }} aria-labelledby="tests-h">
        <div className="verdict__head">
          <h3 id="tests-h" className="t-heading m0">Tests</h3>
          <StatusPill tone="neutral">{d.tests.status === "not_run" ? "Not run yet" : d.tests.status}</StatusPill>
        </div>
        <dl className="test-grid">
          <div>
            <dt className="t-caption">Team says</dt>
            <dd className="t-body-strong">{d.tests.claimed}</dd>
          </div>
          <div>
            <dt className="t-caption">Vitest cases found</dt>
            <dd className="stat__value t-num">{d.tests.found.vitestCases}</dd>
            <dd className="t-caption">in {d.tests.found.vitestFiles} files</dd>
          </div>
          <div>
            <dt className="t-caption">Forge tests found</dt>
            <dd className="stat__value t-num">{d.tests.found.forgeTests}</dd>
            <dd className="t-caption">in {d.tests.found.forgeFiles} files</dd>
          </div>
        </dl>
        <p className="t-caption m0">{d.tests.note}</p>
      </section>

      {c && (
        <section className="card stack rise" style={{ "--i": 3 }} aria-labelledby="cont-h">
          <h3 id="cont-h" className="t-heading m0">Built at the event?</h3>
          <div className="stack-xs">
            <span className="t-caption t-num">
              {c.commitsDuringEvent} of {totalCommits} commits during the event, after {c.boundaryCommit}
            </span>
            <Progress value={c.commitsDuringEvent} max={totalCommits || 1} label="Commits made during the event" />
          </div>
          <p className="t-body m0">{c.assessment}</p>
        </section>
      )}

      <Block title="How it's built" count={d.architecture.length}>
        <ul className="arch">
          {d.architecture.map((a) => (
            <li key={a.component}>
              <span className="t-body-strong">{a.component}</span>
              <span className="t-body">{a.detail}</span>
              {a.refs?.length > 0 && <div className="refs">{a.refs.map(ref)}</div>}
            </li>
          ))}
        </ul>
      </Block>
      <Block title="User journey" count={d.coreJourney.length}>
        <ol className="dossier-list">
          {d.coreJourney.map((s) => (
            <li key={s} className="t-body">
              {s}
            </li>
          ))}
        </ol>
      </Block>
      <Block title="Dependencies" count={d.dependencies.length}>
        <ul className="deps">
          {d.dependencies.map((x) => (
            <li key={`${x.name}${x.ref}`}>
              <span className="t-mono">{x.name}</span>
              <span className="t-mono-caption">{x.version ?? "–"}</span>
            </li>
          ))}
        </ul>
      </Block>

      <p className="t-mono-caption m0 dossier__footer">
        {d.reviewer.name} · {d.reviewer.mode} · {new Date(d.generatedAt).toLocaleString()} · {d.reviewer.method}
      </p>
      </aside>
    </div>
  );
}
