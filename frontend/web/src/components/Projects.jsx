import { useEffect, useState } from "react";
import { StatusPill } from "@ds/ui.jsx";
import { FighterTraits, PixelFighter } from "./PixelFighter.jsx";
import { EVENT } from "../config/event.js";
import { embedUrl, getProject, listProjects } from "../lib/projects.js";
import { Link } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";

const trackName = (id) => EVENT.tracks.find((t) => t.id === id)?.name ?? id;

function KindPill({ kind }) {
  return kind === "sample" ? <StatusPill tone="neutral">Sample project</StatusPill> : <StatusPill tone="success">✓ Submitted</StatusPill>;
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

function StatTile({ label, value, note }) {
  return (
    <div className="card stat">
      <span className="t-label">{label}</span>
      <span className="stat__value t-num">{value}</span>
      <span className="t-caption">{note}</span>
    </div>
  );
}

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
          <h1 className="t-display-lg m0">Projects</h1>
          <p className="t-body m0 muted">{EVENT.name}. Every project competes for finalist; tracks are extra.</p>
        </div>
        <Link to="/submit" className="btn btn--primary">
          Submit a project
        </Link>
      </div>

      <section className="stats" aria-label="Summary">
        <StatTile label="Projects" value={projects ? all.length : "–"} note="All entries in the arena" />
        <StatTile
          label="Submitted by teams"
          value={projects ? submitted : "–"}
          note={samples ? `Plus ${samples} sample ${samples === 1 ? "project" : "projects"}` : "No samples"}
        />
        <StatTile label="Tracks in play" value={projects ? `${inPlay.length} of ${EVENT.tracks.length}` : "–"} note="Sponsor tracks with at least one entry" />
        <StatTile
          label="Most entered track"
          value={leaders.length === 0 ? "–" : leaders.length === 1 ? leaders[0].name : `${leaders.length}-way tie`}
          note={
            leaders.length === 0
              ? "No tracks picked yet"
              : leaders.length === 1
                ? plural(most)
                : `${leaders.map((t) => t.name).join(", ")}, ${most} each`
          }
        />
      </section>

      <section className="filters" aria-label="Filter projects">
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
      </section>

      {projects && (
        <p className="t-caption m0" role="status" aria-live="polite">
          {filtered ? `Showing ${shown.length} of ${all.length}` : `${all.length} ${all.length === 1 ? "project" : "projects"}`}
        </p>
      )}

      {projects && shown.length === 0 && (
        <div className="card card--surface empty">
          <p className="t-body m0">{all.length ? "No projects match these filters." : "No projects yet. Submit yours and it shows up here."}</p>
          {filtered && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters({ track: "", q: "" })}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <ul className="fighter-grid">
        {shown.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${encodeURIComponent(p.id)}`} className="fighter-tile">
              <PixelFighter project={p} scale={6} className="fighter-tile__avatar" />
              <div className="fighter-tile__main">
                <div className="fighter-tile__title">
                  <h2 className="t-heading m0">{p.name}</h2>
                  <KindPill kind={p.kind} />
                </div>
                <div className="card fighter-tile__box">
                  <p className="t-caption m0">{p.teamName}</p>
                  <p className="t-body m0 project-card__pitch">{p.pitch}</p>
                  <Tracks ids={p.tracks} />
                  <div className="project-card__foot t-mono-caption">
                    <span>{p.repoUrl.replace(/^https:\/\/(www\.)?github\.com\//, "")}</span>
                    <span>{p.submittedAt ? new Date(p.submittedAt).toLocaleDateString() : p.event ?? ""}</span>
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProjectPage({ id }) {
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
        <div className="card card--surface">
          <h1 className="t-display-md m0">We can't find that project</h1>
          <p className="t-body">It may have been entered in a different browser. Submissions only live on the device that sent them for now.</p>
        </div>
      </>
    );
  }

  const embed = embedUrl(p.videoUrl);
  return (
    <>
      {back}
      <div className="project-layout">
      <aside className="project-layout__side" aria-label="Fighter">
        <div className="fighter-stage">
          <PixelFighter project={p} scale={11} />
        </div>
        <div className="stack-xs">
          <span className="t-label">Built from this project</span>
          <FighterTraits project={p} trackName={trackName} />
        </div>
      </aside>
      <div className="project-layout__main">
      <header className="intro">
        <KindPill kind={p.kind} />
        <h1 className="t-display-lg m0">{p.name}</h1>
        <p className="t-prompt m0">{p.pitch}</p>
      </header>

      <section className="card stack" aria-label="Demo video">
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

      <section className="card stack" aria-labelledby="about-h">
        <h2 id="about-h" className="t-display-md m0">What it does and how it's built</h2>
        {p.description.split(/\n{2,}/).map((para, i) => (
          <p key={i} className="t-body m0">
            {para}
          </p>
        ))}
      </section>

      <section className="card" aria-labelledby="facts-h">
        <h2 id="facts-h" className="visually-hidden">Details</h2>
        <dl className="facts">
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
                {p.repoUrl.replace(/^https:\/\//, "")}
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
              <dt className="t-label">Originally at</dt>
              <dd>
                <a className="t-body" href={p.showcaseUrl} target="_blank" rel="noreferrer">
                  {p.event ?? "ETHGlobal showcase"}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </section>
      </div>
      </div>
    </>
  );
}
