import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { trackNameOf } from "../lib/events.js";
import { useOrganizer } from "../lib/organizer.js";
import { forgetProject, getProject } from "../lib/projects.js";
import { usePoll } from "../lib/chain.js";
import { peek } from "../lib/cache.js";
import { Link, navigate } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";
import { api } from "../lib/api.js";
import { rerunReview } from "../lib/review.js";
import { ReviewTab } from "./review/ReviewTab.jsx";
import { OrganizerGate } from "./OrganizerGate.jsx";
import { DemoVideo } from "./DemoVideo.jsx";
import { Ring } from "./Arena.jsx";
import { toast } from "./Feedback.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";
import { SplitWords, bouncy, easeOut, stagger } from "./fx.jsx";
import { StorageProof } from "./ZeroGProof.jsx";
import { FighterEns } from "./EnsName.jsx";
import { EventBadge, Tracks } from "./Projects.jsx";

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
      <button type="button" className="btn btn--oracle btn--sm" onClick={go} disabled={busy || running} title="Runs every step again: code review, demo, live test, fact-check, judges">
        {busy ? "Starting…" : running ? "Review running…" : "↻ Run the review again"}
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

/** Which side of a project page is showing; kept in ?view= so it can be linked. */
function useView() {
  const [view, setViewState] = useState(() => (new URLSearchParams(location.search).get("view") === "judge" ? "judge" : "team"));
  const setView = (v) => {
    setViewState(v);
    history.replaceState({}, "", v === "judge" ? `${location.pathname}?view=judge` : location.pathname);
  };
  return [view, setView];
}

/** Segmented toggle: real tabs (arrow keys move between them), sliding thumb. */
function ViewToggle({ view, onChange, hasDossier, review }) {
  const tabs = [
    { id: "team", label: "Submission", hint: "From the team" },
    {
      id: "judge",
      label: "Review",
      hint: review?.status === "reviewing" ? "Reviewing now" : review?.status === "queued" ? "In the queue" : hasDossier ? "From the AI judges" : "Pending",
    },
  ];
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = view === "team" ? "judge" : "team";
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div className="toggle rise" style={{ "--i": 2 }} role="tablist" aria-label="Project view" data-view={view} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={view === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={view === t.id ? 0 : -1}
          className={`toggle__tab toggle__tab--${t.id}`}
          onClick={() => onChange(t.id)}
        >
          {view === t.id && (
            <motion.span layoutId="view-thumb" className={`toggle__thumb toggle__thumb--${t.id}`} transition={{ type: "spring", stiffness: 420, damping: 32 }} aria-hidden="true" />
          )}
          <span className="toggle__label">{t.label}</span>
          <span className="toggle__hint">{t.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function ProjectPage({ id, wallet }) {
  const [wantedView, setView] = useView();
  // Reviews are only for organizers. Everyone else sees what the team submitted.
  const { isOrganizer } = useOrganizer(wallet);
  const view = isOrganizer ? wantedView : "team";
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
          {isOrganizer && (
            <div className="project-actions">
              <RerunReview
                project={p}
                onStarted={() => {
                  setView("judge");
                  refresh();
                }}
              />
              <DeleteProject project={p} />
            </div>
          )}
          <motion.div className="gear-row" aria-label="Fighter gear" initial="hidden" animate="show" variants={stagger(0.06, 0.45)}>
            {fighterTraitItems(p, trackNameOf).map((t) => (
              <motion.span key={t.id} className="chip chip--tag chip--gear" title={t.why} variants={{ hidden: { opacity: 0, scale: 0.6, y: 8 }, show: { opacity: 1, scale: 1, y: 0, transition: bouncy } }}>
                {t.label}
              </motion.span>
            ))}
          </motion.div>
        </div>
      </header>

      {isOrganizer && <ViewToggle view={view} onChange={setView} hasDossier={Boolean(p.dossier || p.hasDossier) || p.review?.status === "reviewed"} review={p.review} />}

      <AnimatePresence mode="wait" initial={false}>
      {view === "team" ? (
        <motion.section
          id="panel-team"
          role="tabpanel"
          aria-labelledby="tab-team"
          className="panel panel--team"
          key="team"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24, transition: { duration: 0.15 } }}
          transition={{ duration: 0.4, ease: easeOut }}
        >
          <div className="team-main">
          <DemoVideo project={p} />

          <section className="card stack about rise" style={{ "--i": 3 }} aria-labelledby="about-h">
            <h3 id="about-h" className="t-heading m0">About</h3>
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
        </motion.section>
      ) : (
        <motion.section
          id="panel-judge"
          role="tabpanel"
          aria-labelledby="tab-judge"
          className="panel panel--judge"
          key="judge"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
          transition={{ duration: 0.4, ease: easeOut }}
        >
          <OrganizerGate wallet={wallet}><ReviewTab project={p} /></OrganizerGate>
        </motion.section>
      )}
      </AnimatePresence>
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
        <span className="t-mono-caption">{p.submittedAt ? ago(p.submittedAt) : ""}</span>
      </div>
      <dl className="entry__list">
        <div>
          <dt>Team</dt>
          <dd className="t-body-strong">{p.teamName || "—"}</dd>
        </div>
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
            <dt>Owner wallet</dt>
            <dd className="t-mono" title={p.ownerWallet}>
              {shortAddress(p.ownerWallet)}
            </dd>
          </div>
        )}
        {p.submittedAt && (
          <div>
            <dt>Submitted</dt>
            <dd className="t-body">{new Date(p.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
          </div>
        )}
        {p.showcaseUrl && (
          <div>
            <dt>Showcase</dt>
            <dd>
              <a className="t-body" href={p.showcaseUrl} target="_blank" rel="noopener noreferrer">
                {p.event ?? "ETHGlobal"} ↗
              </a>
            </dd>
          </div>
        )}
      </dl>
      <FighterEns projectId={p.id} />
      {p.kind === "submitted" && <StorageProof kind="submission" id={p.id} />}
    </aside>
  );
}
