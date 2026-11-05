import { useEffect, useState } from "react";
import { Progress, StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { useCountUp } from "../lib/motion.js";
import { embedUrl, getProject, listProjects } from "../lib/projects.js";
import { Link } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";
import { Ring } from "./Arena.jsx";
import { Dossier } from "./Dossier.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";

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

function StatTile({ label, value, note, children, i }) {
  const shown = useCountUp(value);
  return (
    <div className="card stat rise" style={{ "--i": i }}>
      <span className="t-label">{label}</span>
      <span className="stat__value t-num">{shown}</span>
      {children}
      <span className="t-caption">{note}</span>
    </div>
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
      <div className="hero__copy">
        <span className="event-badge rise" style={{ "--i": 0 }}>
          {EVENT.name}
        </span>
        <h1 id="hero-h" className="t-display-xl m0 rise" style={{ "--i": 1 }}>
          <span className="t-num hero__count">{count}</span> {count === 1 ? "fighter" : "fighters"} in the arena
        </h1>
        <p className="t-body m0 hero__lede rise" style={{ "--i": 2 }}>
          Every project becomes an AI fighter. Three judges score the evidence, and the fight shows the score.
        </p>
        <div className="hero__actions rise" style={{ "--i": 3 }}>
          <Link to="/submit" className="btn btn--primary btn--lg">
            Submit your project
          </Link>
          <a href="#how" className="btn btn--ghost">
            How it works
          </a>
        </div>
      </div>

      <Ring className="hero__ring">
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
    </section>
  );
}

const STEPS = [
  ["Submit", "Seven fields and a public repo. Takes two minutes."],
  ["We read the code", "We pin your commit, run the tests and build an evidence dossier."],
  ["Your fighter battles", "Three AI judges score five rounds. Health follows the score."],
];

function HowItWorks() {
  return (
    <section id="how" className="how" aria-labelledby="how-h">
      <h2 id="how-h" className="visually-hidden">
        How it works
      </h2>
      <ol className="how__list">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="how__step rise" style={{ "--i": i + 4 }}>
            <span className="how__num t-num">{i + 1}</span>
            <div>
              <h3 className="t-heading m0">{title}</h3>
              <p className="t-caption m0">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------- landing */

export function LandingPage() {
  const [projects, setProjects] = useState(null);
  useEffect(() => {
    listProjects().then(setProjects);
  }, []);
  return (
    <>
      <ArenaHero projects={projects} />
      <HowItWorks />
      <section className="landing-cta rise" style={{ "--i": 8 }} aria-label="See the roster">
        <p className="t-heading m0">Meet the fighters already in the ring.</p>
        <Link to="/projects" className="btn btn--secondary">
          See all projects <span aria-hidden="true">→</span>
        </Link>
      </section>
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
          <h1 className="t-display-lg m0 rise">Projects</h1>
          <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
            {EVENT.name}. Every project competes for finalist; tracks are extra.
          </p>
        </div>
        <Link to="/submit" className="btn btn--primary rise" style={{ "--i": 2 }}>
          Submit a project
        </Link>
      </div>

      <section className="stats" aria-label="Summary">
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
      </section>

      <section className="roster-section" aria-labelledby="roster-h">
        <div className="section-head">
          <h2 id="roster-h" className="t-display-md m0">
            The roster
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
          <input
            id="search"
            className="input filters__search"
            type="search"
            placeholder="Search by project, team or pitch"
            value={filters.q}
            onChange={(e) => setFilters({ q: e.target.value })}
          />
          <div className="chips" role="group" aria-label="Filter by track">
            <button type="button" className="chip" aria-pressed={!filters.track} onClick={() => setFilters({ track: "" })}>
              All tracks
            </button>
            {EVENT.tracks.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                aria-pressed={filters.track === t.id}
                onClick={() => setFilters({ track: filters.track === t.id ? "" : t.id })}
              >
                {t.name} <span className="t-num chip__count">{counts[t.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {projects && shown.length === 0 && (
          <div className="card card--surface empty">
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
          </div>
        )}

        <ul className="fighter-grid" key={`${filters.track}|${needle}`}>
          {shown.map((p, i) => (
            <li key={p.id} className="rise" style={{ "--i": Math.min(i, 8) }}>
              <Link to={`/projects/${encodeURIComponent(p.id)}`} className="card fighter-card">
                <Ring compact className="fighter-card__stage">
                  <PixelFighter project={p} scale={7} />
                </Ring>
                <div className="fighter-card__body">
                  <div className="fighter-card__badges">
                    <EventBadge project={p} />
                    {p.kind === "sample" && <StatusPill tone="neutral">Sample</StatusPill>}
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
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* --------------------------------------------------------- project page */

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
      <span className="toggle__thumb" aria-hidden="true" />
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

  if (state.loading) return back;
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

  const embed = embedUrl(p.videoUrl);
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
          <h1 className="t-display-xl m0 project-head__name">{p.name}</h1>
          <p className="t-prompt m0">{p.pitch}</p>
          <p className="t-caption m0">by {p.teamName}</p>
          <div className="gear-row" aria-label="Fighter gear">
            {fighterTraitItems(p, trackName).map((t) => (
              <span key={t.id} className="chip chip--tag" title={t.why}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <ViewToggle view={view} onChange={setView} hasDossier={Boolean(p.dossier)} />

      {view === "team" ? (
        <section id="panel-team" role="tabpanel" aria-labelledby="tab-team" className="panel panel--team" key="team">
          <section className="card stack rise" style={{ "--i": 2 }} aria-label="Demo video">
            {embed ? (
              <div className="video">
                <iframe src={embed} title={`${p.name} demo video`} allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
              </div>
            ) : (
              <p className="t-body m0">This video can't be embedded.</p>
            )}
            <a className="t-caption" href={p.videoUrl} target="_blank" rel="noreferrer">
              Open the demo video
            </a>
          </section>

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
        </section>
      ) : (
        <section id="panel-judge" role="tabpanel" aria-labelledby="tab-judge" className="panel panel--judge" key="judge">
          <Dossier project={p} />
        </section>
      )}
    </>
  );
}
