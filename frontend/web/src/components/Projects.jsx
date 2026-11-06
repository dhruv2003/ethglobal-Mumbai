import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Progress, StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
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
import { removeLocalSubmission } from "../lib/storage.js";
import { JudgesPanel } from "./JudgesPanel.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";
import { FloatSticker, Magnetic, Marquee, Reveal, SplitWords, Squiggle, Tilt, bouncy, easeOut, fadeUp, stagger } from "./fx.jsx";

export const trackName = (id) => EVENT.tracks.find((t) => t.id === id)?.name ?? id;
const GHOST = { id: "your-fighter", name: "Your fighter", pitch: "", description: "", tracks: [] };
const ROSTER_MAX = 6;

function KindPill({ kind }) {
  return kind === "sample" ? <StatusPill tone="neutral">Sample</StatusPill> : <StatusPill tone="success">✓ Submitted</StatusPill>;
}

/** Where the project was built. Prominent: it frames everything else on the card. */
function EventBadge({ project }) {
  return <span className="event-badge">{project.event ?? EVENT.name}</span>;
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
  if (review.status === "reviewed") return <StatusPill tone="success">✓ Reviewed</StatusPill>;
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
    return { track: q.get("track") ?? "", q: q.get("q") ?? "" };
  };
  const [f, setF] = useState(read);
  const update = (next) => {
    const merged = { ...f, ...next };
    setF(merged);
    const q = new URLSearchParams();
    if (merged.track) q.set("track", merged.track);
    if (merged.q) q.set("q", merged.q);
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

function ArenaHero({ projects }) {
  const count = useCountUp(projects?.length ?? 0);
  const roster = (projects ?? []).slice(0, ROSTER_MAX);
  // Everyone stands on the mat in one row: shrink as the roster grows.
  const slots = roster.length + 1;
  const scale = slots <= 5 ? 5 : slots <= 7 ? 4 : 3;
  return (
    <section className="hero" aria-labelledby="hero-h">
      <motion.div className="hero__copy" initial="hidden" animate="show" variants={stagger(0.09, 0.05)}>
        <motion.span className="event-badge event-badge--live" variants={fadeUp}>
          <span className="live-dot" aria-hidden="true" />
          {EVENT.name}
        </motion.span>
        <h1 id="hero-h" className="t-display-xl m0 hero__title">
          <SplitWords delay={0.12}>
            <span className="t-num hero__count">{count}</span>
            {count === 1 ? "fighter" : "fighters"} in the
            <span className="hero__arena">
              arena
              <Squiggle className="hero__squiggle" delay={0.9} />
            </span>
          </SplitWords>
        </h1>
        <motion.p className="t-body m0 hero__lede" variants={fadeUp}>
          Every project becomes an AI fighter. Three judges score the evidence, and the fight shows the score.
        </motion.p>
        <motion.div className="hero__actions" variants={fadeUp}>
          <Magnetic>
            <Link to="/submit" className="btn btn--crush btn--lg btn--arrow">
              Submit your project <span aria-hidden="true">→</span>
            </Link>
          </Magnetic>
          <a href="#how" className="btn btn--ghost btn--underline">
            How it works
          </a>
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
                <Link to="/submit" className="roster__link roster__link--ghost">
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
  ["Submit", "Seven fields and a public repo. Takes two minutes.", "crush"],
  ["We read the code", "We pin your commit, run the tests and build an evidence dossier.", "oracle"],
  ["Your fighter battles", "Three AI judges score five rounds. Health follows the score.", "sunny"],
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
          From repo to ring in three moves
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
    listProjects().then(setProjects);
  }, []);
  const parade = (projects ?? []).slice(0, 4);
  return (
    <>
      <ArenaHero projects={projects} />
      <Marquee className="band" items={EVENT.tracks.map((t) => t.name)} label="Sponsor tracks" />
      <HowItWorks />
      <Reveal as="section" className="landing-cta" aria-label="See the roster">
        <div className="landing-cta__copy">
          <span className="eyebrow eyebrow--ink">The roster</span>
          <p className="t-display-md m0">Meet the fighters already in the ring.</p>
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

export function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  const [filters, setFilters] = useFilters();
  useEffect(() => {
    listProjects().then(setProjects);
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

  const all = projects ?? [];
  const counts = Object.fromEntries(EVENT.tracks.map((t) => [t.id, all.filter((p) => p.tracks.includes(t.id)).length]));
  const inPlay = EVENT.tracks.filter((t) => counts[t.id] > 0);
  const most = Math.max(0, ...inPlay.map((t) => counts[t.id]));
  const leaders = inPlay.filter((t) => counts[t.id] === most);
  const plural = (n) => `${n} ${n === 1 ? "project" : "projects"}`;
  const submitted = all.filter((p) => p.kind === "submitted").length;
  const samples = all.length - submitted;

  const needle = filters.q.trim().toLowerCase();
  const shown = all.filter(
    (p) =>
      (!filters.track || p.tracks.includes(filters.track)) &&
      (!needle || [p.name, p.teamName, p.pitch].some((x) => x.toLowerCase().includes(needle))),
  );
  const filtered = Boolean(filters.track || needle);

  return (
    <>
      <div className="intro intro--row">
        <div className="intro">
          <span className="eyebrow rise">{EVENT.name}</span>
          <h1 className="t-display-lg m0">
            <SplitWords>The arena roster</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
            Every project competes for finalist; tracks are extra.
          </p>
        </div>
        <Link to="/submit" className="btn btn--primary btn--arrow rise" style={{ "--i": 3 }}>
          Submit a project <span aria-hidden="true">→</span>
        </Link>
      </div>

      <motion.section className="stats" aria-label="Summary" initial="hidden" animate="show" variants={stagger(0.08, 0.15)}>
        <StatTile i={3} label="Projects" value={all.length} note="All entries in the arena" />
        <StatTile
          i={4}
          label="Submitted by teams"
          value={submitted}
          note={samples ? `Plus ${samples} sample ${samples === 1 ? "project" : "projects"}` : "No samples"}
        />
        <StatTile i={5} label="Tracks in play" value={inPlay.length} note={`of ${EVENT.tracks.length} sponsor tracks`}>
          <Progress value={inPlay.length} max={EVENT.tracks.length} label="Tracks with at least one entry" />
        </StatTile>
        <StatTile
          i={6}
          label="Most entered track"
          value={leaders.length === 0 ? "–" : leaders.length === 1 ? leaders[0].name : `${leaders.length}-way tie`}
          note={leaders.length === 0 ? "No tracks picked yet" : leaders.length === 1 ? plural(most) : `${leaders.map((t) => t.name).join(", ")}, ${most} each`}
        />
      </motion.section>

      <section className="roster-section" aria-labelledby="roster-h">
        <div className="section-head">
          <h2 id="roster-h" className="t-display-md m0">
            Fighters
          </h2>
          {projects && (
            <span className="t-caption" role="status" aria-live="polite">
              {filtered ? `Showing ${shown.length} of ${all.length}` : plural(all.length)}
            </span>
          )}
        </div>

        <div className="filters">
          <label className="visually-hidden" htmlFor="search">
            Search projects
          </label>
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
          <LayoutGroup id="track-filter">
            <div className="chips" role="group" aria-label="Filter by track">
              {[{ id: "", name: "All tracks" }, ...EVENT.tracks].map((t) => {
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
            <p className="t-body m0">{all.length ? "No fighters match these filters." : "The arena is empty. Be the first in."}</p>
            {filtered ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters({ track: "", q: "" })}>
                Clear filters
              </button>
            ) : (
              <Link to="/submit" className="btn btn--secondary btn--sm">
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
                    {p.kind === "sample" && <StatusPill tone="neutral">Sample</StatusPill>}
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
function DeleteProject({ project }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm(`Delete ${project.name}? Its review, dossier, live test and judge scores go too. This can't be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      if (!project.savedLocallyOnly) await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      removeLocalSubmission(project.id);
      toast(`${project.name} deleted.`);
      navigate("/projects");
    } catch (e) {
      if (e.status === 404) {
        removeLocalSubmission(project.id);
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
function ViewToggle({ view, onChange, hasDossier }) {
  const tabs = [
    { id: "team", label: "Team submission", hint: "What they entered" },
    { id: "judge", label: "Agent judge", hint: hasDossier ? "What our reviewer found" : "Review pending" },
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

export function ProjectPage({ id }) {
  const [view, setView] = useView();
  const [state, setState] = useState({ loading: true, project: null });
  useEffect(() => {
    getProject(id).then((project) => setState({ loading: false, project }));
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
          <p className="t-body m0">It may have been entered in a different browser. Submissions only live on the device that sent them for now.</p>
          <Link to="/projects" className="btn btn--secondary btn--sm back">
            Back to the arena
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
          {p.kind === "submitted" && <DeleteProject project={p} />}
          <motion.div className="gear-row" aria-label="Fighter gear" initial="hidden" animate="show" variants={stagger(0.06, 0.45)}>
            {fighterTraitItems(p, trackName).map((t) => (
              <motion.span key={t.id} className="chip chip--tag chip--gear" title={t.why} variants={{ hidden: { opacity: 0, scale: 0.6, y: 8 }, show: { opacity: 1, scale: 1, y: 0, transition: bouncy } }}>
                {t.label}
              </motion.span>
            ))}
          </motion.div>
        </div>
      </header>

      <ViewToggle view={view} onChange={setView} hasDossier={Boolean(p.dossier) || p.review?.status === "reviewed"} />

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
          <DemoVideo project={p} />

          <section className="card stack rise" style={{ "--i": 3 }} aria-labelledby="about-h">
            <h3 id="about-h" className="t-heading m0">What it does and how it's built</h3>
            {p.description.split(/\n{2,}/).map((para, i) => (
              <p key={i} className="t-body m0">
                {para}
              </p>
            ))}
          </section>

          <section className="card rise" style={{ "--i": 4 }} aria-labelledby="facts-h">
            <h3 id="facts-h" className="visually-hidden">Details</h3>
            <dl className="facts facts--stack">
              <div>
                <dt className="t-label">Team</dt>
                <dd className="t-body">{p.teamName}</dd>
              </div>
              <div>
                <dt className="t-label">Competing in</dt>
                <dd>
                  <Tracks ids={p.tracks} />
                </dd>
              </div>
              <div>
                <dt className="t-label">Source code</dt>
                <dd>
                  <a className="t-mono addr" href={p.repoUrl} target="_blank" rel="noreferrer">
                    {p.repoUrl.replace(/^https:\/\/(www\.)?github\.com\//, "")}
                  </a>
                  {p.pinnedCommit && <div className="t-mono-caption">pinned at {p.pinnedCommit.slice(0, 7)}</div>}
                </dd>
              </div>
              {p.ownerWallet && (
                <div>
                  <dt className="t-label">Owner wallet</dt>
                  <dd className="t-mono" title={p.ownerWallet}>
                    {shortAddress(p.ownerWallet)}
                  </dd>
                </div>
              )}
              {p.submittedAt && (
                <div>
                  <dt className="t-label">Submitted</dt>
                  <dd className="t-body">{new Date(p.submittedAt).toLocaleString()}</dd>
                </div>
              )}
              {p.showcaseUrl && (
                <div>
                  <dt className="t-label">Original showcase</dt>
                  <dd>
                    <a className="t-body" href={p.showcaseUrl} target="_blank" rel="noreferrer">
                      {p.event ?? "ETHGlobal"} ↗
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
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
          <JudgesPanel project={p} />
          <Dossier project={p} />
        </motion.section>
      )}
      </AnimatePresence>
    </>
  );
}
