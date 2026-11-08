import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { trackNameOf } from "../lib/events.js";
import { useOrganizer } from "../lib/organizer.js";
import { forgetProject, getProject } from "../lib/projects.js";
import { usePoll } from "../lib/chain.js";
import { peek } from "../lib/cache.js";
import { Link, navigate } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";
import { api, peekApi } from "../lib/api.js";
import { rerunReview } from "../lib/review.js";
import { ReviewTab } from "./review/ReviewTab.jsx";
import { DemoVideo } from "./DemoVideo.jsx";
import { Ring } from "./Arena.jsx";
import { toast } from "./Feedback.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { SplitWords } from "./fx.jsx";
import { EnsChip, FighterEns } from "./EnsName.jsx";
import { EventBadge, Tracks } from "./Projects.jsx";
import { ClaimBar } from "./review/EvidenceView.jsx";
import { judgeAsFighter } from "./JudgesPage.jsx";
import { BAND_WORD, JUDGE_TONES, band } from "./review/useReviewData.js";
import { fightOfProject } from "../lib/demo/story.js";

/** This project's fight in the arena. */
function FightLink({ id }) {
  const f = fightOfProject(id);
  if (!f) return null;
  return (
    <Link to={f.href} className="btn btn--crush btn--sm btn--arrow">
      {f.live ? "Live" : f.won ? "Won" : "Lost"} vs {f.opponent} <span aria-hidden="true">→</span>
    </Link>
  );
}

function KindPill() {
  return <StatusPill tone="success">✓ Submitted</StatusPill>;
}

/** Run the whole review again (organizer). Opens the Review side to watch it. */
function RerunReview({ project, onStarted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = project.review?.status === "reviewing" || project.review?.status === "queued";
  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await rerunReview(project.id);
      toast(r.review?.position ? `${project.name} is in the review queue (#${r.review.position}).` : `Reviewing ${project.name} again.`);
      onStarted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="quiet-link" onClick={go} disabled={busy || running} title="Runs every step again: code review, demo, live test, fact-check, judges">
        {busy ? "Starting…" : running ? "Reviewing…" : "↻ Replay review"}
      </button>
      {error && <span className="field__error">✕ {error}</span>}
    </>
  );
}

/** Delete a submitted project (organizer). */
function DeleteProject({ project }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm(`Delete ${project.name}? Its review, dossier, live test and judge scores go too. This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      forgetProject(project.id);
      toast(`${project.name} deleted.`);
      navigate("/projects");
    } catch (e) {
      if (e.status === 404) {
        forgetProject(project.id);
        toast(`${project.name} deleted.`);
        navigate("/projects");
        return;
      }
      setError(e.status === 401 || e.status === 403 ? "Deleting needs the organizer key (set it on the Judges page)." : e.message);
      setBusy(false);
    }
  }
  return (
    <div className="delete-row">
      {error && <span className="field__error">✕ {error}</span>}
      <button type="button" className="btn btn--danger btn--sm" onClick={remove} disabled={busy}>
        {busy ? "Deleting…" : "Delete project"}
      </button>
    </div>
  );
}

/** Hero side card: the panel's call at a glance. One number, one bar, three faces. */
function VerdictCard({ project }) {
  const id = encodeURIComponent(project.id);
  const [result, setResult] = useState(() => project.reviews ?? peekApi(`/projects/${id}/reviews`)?.result ?? null);
  const [dossier, setDossier] = useState(() => peekApi(`/projects/${id}/dossier`)?.dossier ?? null);
  const evidence = dossier?.evidence ?? [];
  const score = result?.panelHundredths == null ? null : result.panelHundredths / 100;
  // One word for the call ("Proven", "Overpromised"); the sentence behind it is in the evidence below.
  const word = dossier?.highlights?.word ?? (score == null ? null : BAND_WORD[band(score)]);
  useEffect(() => {
    let alive = true;
    api(`/projects/${id}/reviews`).then((r) => alive && r?.result && setResult(r.result)).catch(() => {});
    api(`/projects/${id}/dossier`).then((d) => alive && d?.dossier && setDossier(d.dossier)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  const b = band(score);
  const backed = evidence.filter((e) => e.status === "supported_by_code").length;
  const judges = (result?.reviews ?? []).filter((r) => r.status === "scored");
  const toEvidence = () => document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth" });

  return (
    <aside className={`vcard vcard--${b} rise`} style={{ "--i": 2 }} aria-label="Agent verdict">
      <span className="vcard__kicker">Agent verdict</span>
      <p className={`vcard__word vcard__word--${b} m0`}>{word ?? "Not judged yet"}</p>
      <div className="vcard__score" title="Average of the three judges' scores">
        <span className="vcard__n t-num">{score == null ? "—" : score.toFixed(1)}</span>
        <span className="vcard__of">/100 judges' score</span>
      </div>
      {evidence.length > 0 && (
        <div className="vcard__claims">
          <ClaimBar evidence={evidence} />
          <span className="t-caption">
            <b className="t-num">{backed}</b> of <span className="t-num">{evidence.length}</span> claims checked out in the code
          </span>
        </div>
      )}
      <div className="vcard__foot">
        {judges.length > 0 && (
          <ul className="vcard__judges m0" aria-label="Judges">
            {judges.map((r, i) => (
              <li key={r.judge.id} className={`vcard__judge vcard__judge--${JUDGE_TONES[i % 3]}`} title={`${r.judge.name}: ${(r.overallHundredths / 100).toFixed(1)}`}>
                <PixelFighter project={judgeAsFighter(r.judge)} scale={2} label={`${r.judge.name}, judge`} />
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="vcard__go" onClick={toEvidence}>
          {score == null ? "See the review" : "See why"} <span aria-hidden="true">↓</span>
        </button>
      </div>
    </aside>
  );
}

export function ProjectPage({ id, wallet }) {
  // Everyone sees the evidence; only organizers get the actions (rerun, delete, ask again).
  const { isOrganizer } = useOrganizer(wallet);
  // The cached list has this project already: show it at once, then swap in the fresh copy.
  // While a review is queued or running, re-read every 5s so its status (and the rerun button) stays current.
  const [watching, setWatching] = useState(false);
  const { data: project, loading, refresh } = usePoll(() => getProject(id), [id], watching ? 5000 : 0, {
    initial: () => peek("projects")?.find((p) => p.id === id) ?? null,
  });
  const reviewing = project?.review?.status === "reviewing" || project?.review?.status === "queued";
  useEffect(() => setWatching(reviewing), [reviewing]);
  const state = { loading: loading && !project, project };

  const back = (
    <Link to="/projects" className="btn btn--ghost btn--sm back">
      ← All projects
    </Link>
  );

  if (state.loading)
    return (
      <>
        {back}
        <div className="project-hero" aria-busy="true">
          <div className="ring skeleton project-hero__ring" />
          <div className="intro">
            <span className="skeleton skeleton--line" style={{ width: "40%" }} />
            <span className="skeleton skeleton--title" />
            <span className="skeleton skeleton--line" style={{ width: "70%" }} />
          </div>
        </div>
      </>
    );
  const p = state.project;
  if (!p) {
    return (
      <>
        {back}
        <div className="card card--surface stack">
          <h1 className="t-display-md m0">We can't find that fighter</h1>
          <p className="t-body m0">It may have been submitted from another browser.</p>
          <Link to="/projects" className="btn btn--secondary btn--sm">
            All projects
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {back}
      <header className="project-hero">
        <Ring className="project-hero__ring rise" style={{ "--i": 0 }}>
          <PixelFighter project={p} scale={8} className="fighter--enter" />
        </Ring>
        <div className="intro project-head rise" style={{ "--i": 1 }}>
          <div className="fighter-card__badges">
            <EventBadge project={p} />
            <KindPill />
          </div>
          <h1 className="t-display-xl m0 project-head__name">
            <SplitWords delay={0.15}>{p.name}</SplitWords>
          </h1>
          <p className="t-prompt m0">{p.pitch}</p>
          <p className="t-caption m0">by {p.teamName}</p>
          <EnsChip id={p.id} />
          <div className="project-actions">
            <FightLink id={p.id} />
            <RerunReview
              project={p}
              onStarted={() => {
                document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth" });
                refresh();
              }}
            />
            {isOrganizer && <DeleteProject project={p} />}
          </div>
          
        </div>
        <VerdictCard project={p} />
      </header>

      <section className="panel panel--team" aria-label="What the team submitted">
        <div className="team-main">
          <DemoVideo project={p} />

          <section className="card stack about rise" style={{ "--i": 3 }} aria-labelledby="about-h">
            <span id="about-h" className="vcard__kicker">About</span>
            <div className="about__body">
              {p.description.split(/\n{2,}/).map((para, i) => (
                <p key={i} className={`m0 ${i === 0 ? "about__lead" : "t-body"}`}>
                  {para}
                </p>
              ))}
            </div>
          </section>
        </div>

        <EntryCard project={p} />
      </section>

      <section id="evidence" className="evidence-section" aria-labelledby="evidence-h">
        <header className="evidence-section__head">
          <span className="eyebrow">The evidence</span>
          <h2 id="evidence-h" className="t-display-md m0">What the agents found</h2>
        </header>
        <ReviewTab project={p} canAct={isOrganizer} />
      </section>
    </>
  );
}

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

/** Team submission tab, side column: everything the team entered besides the story. */
function EntryCard({ project: p }) {
  return (
    <aside className="entry rise" style={{ "--i": 4 }} aria-labelledby="entry-h">
      <div className="entry__band">
        <span id="entry-h">Entry</span>
        <span className="t-mono-caption" title={p.submittedAt ? new Date(p.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : undefined}>
          {p.submittedAt ? `Submitted ${ago(p.submittedAt)}` : ""}
        </span>
      </div>
      <dl className="entry__list">
        <div>
          <dt>Tracks</dt>
          <dd>
            <Tracks ids={p.tracks} />
          </dd>
        </div>
        <div>
          <dt>Code</dt>
          <dd>
            <a className="entry__link" href={p.repoUrl} target="_blank" rel="noopener noreferrer">
              <span aria-hidden="true">{"</>"}</span>
              <span className="t-mono">{p.repoUrl.replace(/^https:\/\/(www\.)?github\.com\//, "")}</span>
              <span aria-hidden="true">↗</span>
            </a>
            {p.pinnedCommit && <div className="t-mono-caption">pinned at {p.pinnedCommit.slice(0, 7)}</div>}
          </dd>
        </div>
        {/^https:\/\//.test(p.liveUrl ?? "") && (
          <div>
            <dt>Live app</dt>
            <dd>
              <a className="entry__link entry__link--live" href={p.liveUrl} target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">●</span>
                <span>{p.liveUrl.replace(/^https:\/\//, "")}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </dd>
          </div>
        )}
        {p.ownerWallet && (
          <div>
            <dt>Owner</dt>
            <dd className="t-mono" title={p.ownerWallet}>
              {shortAddress(p.ownerWallet)}
            </dd>
          </div>
        )}
        {p.showcaseUrl && (
          <div>
            <dt>Showcase</dt>
            <dd>
              <a className="t-body" href={p.showcaseUrl} target="_blank" rel="noopener noreferrer">
                ETHGlobal showcase ↗
              </a>
            </dd>
          </div>
        )}
      </dl>
      <FighterEns projectId={p.id} />
    </aside>
  );
}
