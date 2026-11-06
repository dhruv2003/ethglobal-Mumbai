import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Progress, StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { listEvents, trackNameOf } from "../lib/events.js";
import { useOrganizer } from "../lib/organizer.js";
import { OrganizerGate } from "./OrganizerGate.jsx";
import { useCountUp } from "../lib/motion.js";
import { getProject, listProjects } from "../lib/projects.js";
import { DemoVideo } from "./DemoVideo.jsx";
import { Link } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";
import { Ring } from "./Arena.jsx";
import { Dossier } from "./Dossier.jsx";
import { Spinner, toast } from "./Feedback.jsx";
import { api } from "../lib/api.js";
import { navigate } from "../lib/router.jsx";
import { rerunReview } from "../lib/review.js";
import { JudgesPanel } from "./JudgesPanel.jsx";
import { PipelineView, usePipeline } from "./PipelineView.jsx";
import { ReviewHero } from "./ReviewHero.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";
import { FloatSticker, Magnetic, Marquee, Reveal, SplitWords, Squiggle, Tilt, bouncy, easeOut, fadeUp, stagger } from "./fx.jsx";

export const trackName = (id) => trackNameOf(id);
const GHOST = { id: "your-fighter", name: "Your fighter", pitch: "", description: "", tracks: [] };
const ROSTER_MAX = 6;

function KindPill() {
  return <StatusPill tone="success">✓ Submitted</StatusPill>;
}

/** Where the project was built. Prominent: it frames everything else on the card. */
function EventBadge({ project }) {
  return project.event ? <span className="event-badge">{project.event}</span> : null;
}

/** Where a submitted project's review stands, on its card. */
function ReviewBadge({ review }) {
  if (!review) return null;
  if (review.status === "queued")
    return (
      <span className="review-badge">
        <Spinner size={14} label="Queued" />
        <StatusPill tone="neutral">{review.position ? `In queue · #${review.position}` : "In queue"}</StatusPill>
      </span>
    );
  if (review.status === "reviewing")
    return (
      <span className="review-badge">
        <Spinner size={14} label="Reviewing" />
        <StatusPill tone="live">Reviewing</StatusPill>
      </span>
    );
  if (review.status === "stopped") return <StatusPill tone="danger">✕ Review stopped</StatusPill>;
  if (review.status === "reviewed")
    return review.failed ? <StatusPill tone="neutral">✓ Reviewed · {review.failed} step{review.failed === 1 ? "" : "s"} failed</StatusPill> : <StatusPill tone="success">✓ Reviewed</StatusPill>;
  return null;
}

function Tracks({ ids }) {
  return (
    <div className="chips">
      <span className="chip chip--tag">Finalist</span>
      {ids.map((id) => (
        <span key={id} className="chip chip--tag">
          {trackName(id)}
        </span>
      ))}
    </div>
  );
}

/** Filters live in the URL (?track=&q=) so a filtered view can be shared and survives reload. */
function useFilters() {
  const read = () => {
    const q = new URLSearchParams(location.search);
    return { track: q.get("track") ?? "", q: q.get("q") ?? "", tournament: q.get("tournament") ?? "", mine: q.get("mine") === "1" };
  };
  const [f, setF] = useState(read);
  const update = (next) => {
    const merged = { ...f, ...next };
    setF(merged);
    const q = new URLSearchParams();
    if (merged.track) q.set("track", merged.track);
    if (merged.q) q.set("q", merged.q);
    if (merged.tournament) q.set("tournament", merged.tournament);
    if (merged.mine) q.set("mine", "1");
    history.replaceState({}, "", `${location.pathname}${q.toString() ? `?${q}` : ""}`);
  };
  return [f, update];
}

const TILE_TONES = ["crush", "oracle", "sunny", "ink"];

function StatTile({ label, value, note, children, i }) {
  const shown = useCountUp(value);
  return (
    <motion.div className={`card stat stat--${TILE_TONES[(i - 3) % 4]}`} variants={fadeUp} whileHover={{ y: -4 }} transition={bouncy}>
      <span className="stat__label">
        <span className="stat__swatch" aria-hidden="true" />
        {label}
      </span>
      <span className="stat__value t-num">{shown}</span>
      {children}
      <span className="t-caption">{note}</span>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- hero */

function ArenaHero({ projects, eventName }) {
  const roster = (projects ?? []).slice(0, ROSTER_MAX);
  // Everyone stands on the mat in one row: shrink as the roster grows.
  const slots = roster.length + 1;
  const scale = slots <= 5 ? 5 : slots <= 7 ? 4 : 3;
  return (
    <section className="hero" aria-labelledby="hero-h">
      <motion.div className="hero__copy" initial="hidden" animate="show" variants={stagger(0.09, 0.05)}>
        <motion.span className="event-badge event-badge--live" variants={fadeUp}>
          <span className="live-dot" aria-hidden="true" />
          {eventName ?? EVENT.name}
        </motion.span>
        <h1 id="hero-h" className="t-display-xl m0 hero__title">
          <SplitWords delay={0.12}>
            Your code steps into the
            <span className="hero__arena">
              ring
              <Squiggle className="hero__squiggle" delay={0.9} />
            </span>
          </SplitWords>
        </h1>
        <motion.p className="t-body m0 hero__lede" variants={fadeUp}>
          Every project becomes a fighter. Three AI judges score the code, and the fight shows who wins.
        </motion.p>
        <motion.div className="hero__actions" variants={fadeUp}>
          <Magnetic>
            <Link to="/tournaments" className="btn btn--crush btn--lg btn--arrow">
              Submit your project <span aria-hidden="true">→</span>
            </Link>
          </Magnetic>
          <Link to="/arena" className="btn btn--ghost btn--underline">
            Watch a fight
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero__stage"
        initial={{ opacity: 0, scale: 0.94, rotate: 2 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.15 }}
      >
        <Tilt className="hero__tilt" max={5}>
          <Ring className="hero__ring">
            <span className="hero__spot" aria-hidden="true" />
            <ul className="roster" aria-label="Fighters in the arena">
              {roster.map((p, i) => (
                <li key={p.id} className="roster__slot" style={{ "--i": i }}>
                  <Link to={`/projects/${encodeURIComponent(p.id)}`} className="roster__link">
                    <PixelFighter project={p} scale={scale} />
                    <span className="roster__name">{p.name}</span>
                  </Link>
                </li>
              ))}
              <li className="roster__slot" style={{ "--i": roster.length }}>
                <Link to="/tournaments" className="roster__link roster__link--ghost">
                  <PixelFighter project={GHOST} scale={scale} ghost label="Empty slot for your fighter" />
                  <span className="roster__name roster__name--always">Your fighter?</span>
                </Link>
              </li>
            </ul>
          </Ring>
        </Tilt>
        <FloatSticker className="float-sticker--sunny hero__sticker hero__sticker--1" rotate={-8} delay={0.7}>
          3 AI judges
        </FloatSticker>
        <FloatSticker className="float-sticker--crush hero__sticker hero__sticker--2" rotate={7} delay={0.85} drift={10}>
          5 rounds ⚡
        </FloatSticker>
        <FloatSticker className="float-sticker--oracle hero__sticker hero__sticker--3" rotate={-4} delay={1} drift={6}>
          Evidence &gt; hype
        </FloatSticker>
      </motion.div>
    </section>
  );
}

const STEPS = [
  ["Submit", "A public repo and a short form. Two minutes.", "crush"],
  ["We read the code", "We pin your commit, run the tests and collect evidence.", "oracle"],
  ["You fight", "Three AI judges score five rounds. Health follows the score.", "sunny"],
];

/** Tiny line icons for the three steps. */
function StepIcon({ n }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="how__icon" viewBox="0 0 32 32" aria-hidden="true">
      {n === 0 && (
        <g {...common}>
          <rect x="6" y="4" width="20" height="24" rx="4" />
          <path d="M11 12h10M11 17h10M11 22h6" />
        </g>
      )}
      {n === 1 && (
        <g {...common}>
          <path d="M11 9 4 16l7 7M21 9l7 7-7 7M18 6l-4 20" />
        </g>
      )}
      {n === 2 && (
        <g {...common}>
          <path d="M6 26 20 12M20 12l3-7 4 4-7 3M26 26 12 12M12 12 9 5 5 9l7 3" />
        </g>
      )}
    </svg>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="how" aria-labelledby="how-h">
      <Reveal className="section-title">
        <span className="eyebrow">How it works</span>
        <h2 id="how-h" className="t-display-md m0">
          Repo to ring in three steps
        </h2>
      </Reveal>
      <motion.ol className="how__list" initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} variants={stagger(0.12)}>
        {STEPS.map(([title, body, tone], i) => (
          <motion.li key={title} className="how__item" variants={fadeUp}>
            <Tilt className={`how__step how__step--${tone}`} max={6}>
              <div className="how__top">
                <span className="how__num t-num">0{i + 1}</span>
                <span className={`how__badge how__badge--${tone}`}>
                  <StepIcon n={i} />
                </span>
              </div>
              <h3 className="t-heading m0">{title}</h3>
              <p className="t-caption m0">{body}</p>
            </Tilt>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  );
}

/* ------------------------------------------------------------- landing */

export function LandingPage() {
  const [projects, setProjects] = useState(null);
  useEffect(() => {
    listProjects().then(setProjects, () => setProjects([]));
  }, []);
  const [events, setEvents] = useState([]);
  useEffect(() => {
    listEvents().then(setEvents, () => setEvents([]));
  }, []);
  const latest = events.at(-1);
  const parade = (projects ?? []).slice(0, 4);
  return (
    <>
      <ArenaHero projects={projects} eventName={latest?.name} />
      {latest && <Marquee className="band" items={latest.tracks.map((t) => t.name)} label="Tracks" />}
      <HowItWorks />
      <Reveal as="section" className="landing-cta" aria-label="See the roster">
        <div className="landing-cta__copy">
          <p className="t-display-md m0">Meet the fighters</p>
          <Link to="/projects" className="btn btn--primary btn--arrow">
            See all projects <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="landing-cta__parade" aria-hidden="true">
          {parade.map((p, i) => (
            <motion.span
              key={p.id}
              className="landing-cta__fighter"
              initial={{ y: 60, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ ...bouncy, delay: 0.2 + i * 0.1 }}
            >
              <PixelFighter project={p} scale={6} />
            </motion.span>
          ))}
          <motion.span
            className="landing-cta__fighter"
            initial={{ y: 60, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ ...bouncy, delay: 0.2 + parade.length * 0.1 }}
          >
            <PixelFighter project={GHOST} scale={6} ghost />
          </motion.span>
        </div>
      </Reveal>
    </>
  );
}

/* ----------------------------------------------------------- dashboard */

export function ProjectsPage({ wallet }) {
  const [projects, setProjects] = useState(null);
  const [events, setEvents] = useState([]);
  useEffect(() => {
    listEvents().then(setEvents, () => setEvents([]));
  }, []);
  const [filters, setFilters] = useFilters();
  useEffect(() => {
    listProjects().then(setProjects, () => {
      setProjects([]);
      toast("Couldn't reach the server, so projects can't be listed.", { tone: "warning", ms: 6000 });
    });
  }, []);
  // "/" jumps to search, like most dashboards.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || /input|textarea|select/i.test(document.activeElement?.tagName ?? "")) return;
      e.preventDefault();
      document.getElementById("search")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Projects belong to a tournament: one is always selected, and the track filters are its own.
  const selected = events.find((e) => e.id === filters.tournament) ?? events.at(-1) ?? null;
  const tracks = selected?.tracks ?? [];
  const all = (projects ?? []).filter((p) => p.eventId === selected?.id);
  const counts = Object.fromEntries(tracks.map((t) => [t.id, all.filter((p) => p.tracks.includes(t.id)).length]));
  const inPlay = tracks.filter((t) => counts[t.id] > 0);
  const most = Math.max(0, ...inPlay.map((t) => counts[t.id]));
  const leaders = inPlay.filter((t) => counts[t.id] === most);
  const plural = (n) => `${n} ${n === 1 ? "project" : "projects"}`;
  const submitted = all.filter((p) => p.kind === "submitted").length;

  const needle = filters.q.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      (!filters.track || p.tracks.includes(filters.track)) &&
      (!filters.mine || p.ownerWallet?.toLowerCase() === wallet.address?.toLowerCase()) &&
      (!needle || [p.name, p.teamName, p.pitch].some((x) => x.toLowerCase().includes(needle))),
  );
  const filtered = Boolean(filters.track || needle || filters.mine);

  return (
    <>
      <div className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0">
            <SplitWords>Projects</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
            {selected ? `Every project in ${selected.name}. They all compete for finalist, and tracks are optional.` : "No tournaments yet."}
          </p>
          {events.length > 0 && (
            <div className="trade__presets" role="group" aria-label="Choose a tournament">
              {events.map((e) => (
                <button key={e.id} type="button" className="chip chip--anim" aria-pressed={selected?.id === e.id} onClick={() => setFilters({ tournament: e.id, track: "" })}>
                  {e.name}
                </button>
              ))}
              {wallet.address && (
                <button type="button" className="chip chip--anim" aria-pressed={filters.mine} onClick={() => setFilters({ mine: !filters.mine })}>
                  My project
                </button>
              )}
            </div>
          )}
        </div>
        <Link to="/tournaments" className="btn btn--primary btn--arrow rise" style={{ "--i": 3 }}>
          Submit a project <span aria-hidden="true">→</span>
        </Link>
      </div>

      <motion.section className="stats" aria-label="Summary" initial="hidden" animate="show" variants={stagger(0.08, 0.15)}>
        <StatTile i={3} label="Projects" value={all.length} note={`${submitted} submitted by teams`} />
        <StatTile i={5} label="Tracks entered" value={inPlay.length} note={`of ${tracks.length} tracks`}>
          <Progress value={inPlay.length} max={Math.max(1, tracks.length)} label="Tracks with at least one entry" />
        </StatTile>
        <StatTile
          i={6}
          label="Top track"
          value={leaders.length === 0 ? "–" : leaders.length === 1 ? leaders[0].name : `${leaders.length}-way tie`}
          note={leaders.length === 0 ? "No tracks picked yet" : leaders.length === 1 ? plural(most) : leaders.map((t) => t.name).join(", ")}
        />
      </motion.section>

      <section className="roster-section" aria-labelledby="roster-h">
        <h2 id="roster-h" className="visually-hidden">
          All projects
        </h2>
        <div className="filters">
          <label className="visually-hidden" htmlFor="search">
            Search projects
          </label>
          <div className="filters__row">
          <div className="search">
            <svg className="search__icon" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="search"
              className="input filters__search"
              type="search"
              placeholder="Search by project, team or pitch"
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
            />
            <kbd className="search__kbd" aria-hidden="true">/</kbd>
          </div>
          {projects && (
            <span className="t-caption" role="status" aria-live="polite">
              {filtered ? `Showing ${shown.length} of ${all.length}` : plural(all.length)}
            </span>
          )}
          </div>
          <LayoutGroup id="track-filter">
            <div className="chips" role="group" aria-label="Filter by track">
              {[{ id: "", name: "All tracks" }, ...tracks].map((t) => {
                const on = t.id ? filters.track === t.id : !filters.track;
                return (
                  <button
                    key={t.id || "all"}
                    type="button"
                    className="chip chip--anim"
                    aria-pressed={on}
                    onClick={() => setFilters({ track: t.id && filters.track !== t.id ? t.id : "" })}
                  >
                    {on && <motion.span layoutId="chip-on" className="chip__on" transition={{ type: "spring", stiffness: 500, damping: 36 }} aria-hidden="true" />}
                    <span className="chip__text">
                      {t.name}
                      {t.id && <span className="t-num chip__count">{counts[t.id] ?? 0}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
        </div>

        {projects && shown.length === 0 && (
          <motion.div className="card card--surface empty" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={bouncy}>
            <p className="t-body m0">{all.length ? "No projects match." : "No projects yet. Be the first."}</p>
            {filtered ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters({ track: "", q: "" })}>
                Clear filters
              </button>
            ) : (
              <Link to="/tournaments" className="btn btn--secondary btn--sm">
                Submit a project
              </Link>
            )}
          </motion.div>
        )}

        {!projects && (
          <ul className="fighter-grid" aria-hidden="true">
            {[0, 1].map((k) => (
              <li key={k} className="card fighter-card skeleton" />
            ))}
          </ul>
        )}

        <motion.ul className="fighter-grid" layout>
          <AnimatePresence mode="popLayout">
          {shown.map((p, i) => (
            <motion.li
              key={p.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { ...bouncy, delay: Math.min(i, 8) * 0.05 } }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
            >
              <Tilt className="fighter-card__tilt" max={4}>
              <Link to={`/projects/${encodeURIComponent(p.id)}`} className="card fighter-card">
                <Ring compact className="fighter-card__stage">
                  <PixelFighter project={p} scale={7} />
                </Ring>
                <div className="fighter-card__body">
                  <div className="fighter-card__badges">
                    <EventBadge project={p} />
                    
                    <ReviewBadge review={p.review} />
                  </div>
                  <div>
                    <h3 className="t-display-md m0 fighter-card__name">{p.name}</h3>
                    <p className="t-caption m0">by {p.teamName}</p>
                  </div>
                  <p className="t-body m0 fighter-card__pitch">{p.pitch}</p>
                  <Tracks ids={p.tracks} />
                  <span className="fighter-card__cta">
                    View fighter <span aria-hidden="true">→</span>
                  </span>
                </div>
              </Link>
              </Tilt>
            </motion.li>
          ))}
          </AnimatePresence>
        </motion.ul>
      </section>
    </>
  );
}

/* --------------------------------------------------------- project page */

/** Delete a submitted project (organizer). Local-only drafts just leave this browser. */
/** Run the whole review again (organizer). Opens the Agent judge side to watch it. */
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

function DeleteProject({ project }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm(`Delete ${project.name}? Its review, dossier, live test and judge scores go too. This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      toast(`${project.name} deleted.`);
      navigate("/projects");
    } catch (e) {
      if (e.status === 404) {
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
  const [state, setState] = useState({ loading: true, project: null });
  useEffect(() => {
    getProject(id).then(
      (project) => setState({ loading: false, project }),
      () => setState({ loading: false, project: null }),
    );
  }, [id]);

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
            <KindPill kind={p.kind} />
          </div>
          <h1 className="t-display-xl m0 project-head__name">
            <SplitWords delay={0.15}>{p.name}</SplitWords>
          </h1>
          <p className="t-prompt m0">{p.pitch}</p>
          <p className="t-caption m0">by {p.teamName}</p>
          {isOrganizer && (
            <div className="project-actions">
              <RerunReview project={p} onStarted={() => setView("judge")} />
              <DeleteProject project={p} />
            </div>
          )}
          <motion.div className="gear-row" aria-label="Fighter gear" initial="hidden" animate="show" variants={stagger(0.06, 0.45)}>
            {fighterTraitItems(p, trackName).map((t) => (
              <motion.span key={t.id} className="chip chip--tag chip--gear" title={t.why} variants={{ hidden: { opacity: 0, scale: 0.6, y: 8 }, show: { opacity: 1, scale: 1, y: 0, transition: bouncy } }}>
                {t.label}
              </motion.span>
            ))}
          </motion.div>
        </div>
      </header>

      {isOrganizer && <ViewToggle view={view} onChange={setView} hasDossier={Boolean(p.dossier) || p.review?.status === "reviewed"} review={p.review} />}

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
          <OrganizerGate wallet={wallet}><JudgeTab project={p} /></OrganizerGate>
        </motion.section>
      )}
      </AnimatePresence>
    </>
  );
}

/** Agent judge tab: at a glance, the pipeline, the judges, then the evidence. */
function JudgeTab({ project }) {
  const [live, refresh] = usePipeline(project);
  // Remount the panels when a review finishes so they show the new results.
  const round = live.state?.finishedAt ?? "pending";
  return (
    <>
      <ReviewHero project={project} live={live} />
      {project.kind === "submitted" && <PipelineView project={project} live={live} onChanged={refresh} />}
      <JudgesPanel key={`j-${round}`} project={project} />
      <Dossier key={`d-${round}`} project={project} />
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
    </aside>
  );
}
