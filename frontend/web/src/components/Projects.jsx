import { useEffect, useState } from "react";
import { Avatar, StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { embedUrl, getProject, listProjects } from "../lib/projects.js";
import { Link } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";

const trackName = (id) => EVENT.tracks.find((t) => t.id === id)?.name ?? id;
const initials = (name) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

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

export function ProjectsPage() {
  const [projects, setProjects] = useState(null);
  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  return (
    <>
      <div className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0">Projects</h1>
          <p className="t-body m0 muted">
            {projects ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} entered so far.` : "Loading projects…"}
          </p>
        </div>
        <Link to="/" className="btn btn--secondary">
          Enter a project
        </Link>
      </div>

      {projects && projects.length === 0 && (
        <div className="card card--surface">
          <p className="t-body m0">No projects yet. Enter yours and it shows up here.</p>
        </div>
      )}

      <ul className="project-grid">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${encodeURIComponent(p.id)}`} className="card project-card">
              <div className="project-card__head">
                <Avatar initials={initials(p.name)} tint="crush-soft" size={48} />
                <KindPill kind={p.kind} />
              </div>
              <div>
                <h2 className="t-heading m0">{p.name}</h2>
                <p className="t-caption m0">{p.teamName}</p>
              </div>
              <p className="t-body m0 project-card__pitch">{p.pitch}</p>
              <Tracks ids={p.tracks} />
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
    </>
  );
}
