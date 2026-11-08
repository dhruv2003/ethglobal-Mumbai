import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Progress, StatusPill } from "@ds/ui.jsx";
import { listEvents, sortTracks, trackNameOf } from "../lib/events.js";
import { useCountUp } from "../lib/motion.js";
import { listProjects } from "../lib/projects.js";
import { usePoll } from "../lib/chain.js";
import { Link } from "../lib/router.jsx";
import { EnsChip } from "./EnsName.jsx";
import { Ring } from "./Arena.jsx";
import { Spinner, toast } from "./Feedback.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { SplitWords, Tilt, bouncy, fadeUp, stagger } from "./fx.jsx";

/** Where the project was built. Prominent: it frames everything else on the card. */
export function EventBadge({ project }) {
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

/** A project's tracks: sponsors first, the first `max` as chips, the rest behind "+N". */
export function Tracks({ ids = [], max = 3 }) {
  const [open, setOpen] = useState(false);
  const all = sortTracks(ids);
  const shown = open ? all : all.slice(0, max);
  const rest = all.slice(max);
  return (
    <div className="chips">
      {shown.map((id) => (
        <span key={id} className="chip chip--tag">
          {trackNameOf(id)}
        </span>
      ))}
      {rest.length > 0 && (
        <button type="button" className="chip chip--tag chip--more" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? "Show fewer" : rest.map(trackNameOf).join(", ")}>
          {open ? "Less" : `+${rest.length}`}
        </button>
      )}
    </div>
  );
}

/** Every project, shown from the last visit's cache while the backend answers. null while loading with nothing cached. */
export function useProjects() {
  const { data, error } = usePoll(listProjects, [], 0, { key: "projects" });
  return { projects: data ?? (error ? [] : null), error: data ? null : error };
}

/** Every tournament, cached the same way. [] until known. */
export function useEvents() {
  const { data } = usePoll(listEvents, [], 0, { key: "events" });
  return data ?? [];
}

/** Pseudo-tournament id for projects without a (known) tournament. */
const UNASSIGNED = "unassigned";

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
  // In-app links to /projects?… (and back/forward) change the query without remounting: re-read it.
  useEffect(() => {
    const on = () => setF(read());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

/* ----------------------------------------------------------- dashboard */

export function ProjectsPage({ wallet }) {
  const { projects, error: projectsError } = useProjects();
  const events = useEvents();
  const [filters, setFilters] = useFilters();
  // Once per visit, not on every retry.
  const warned = useRef(false);
  useEffect(() => {
    if (!projectsError || warned.current) return;
    warned.current = true;
    toast("Couldn't reach the server, so projects can't be listed.", { tone: "warning", ms: 6000 });
  }, [projectsError]);
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
  // Projects with no tournament (or one that no longer exists) go under "Unassigned" so they never vanish.
  const known = new Set(events.map((e) => e.id));
  const orphans = (projects ?? []).filter((p) => !known.has(p.eventId));
  const unassigned = orphans.length ? { id: UNASSIGNED, name: "Unassigned", tracks: [] } : null;
  const choices = unassigned ? [...events, unassigned] : events;
  const selected = choices.find((e) => e.id === filters.tournament) ?? events.at(-1) ?? unassigned;
  const tracks = selected?.tracks ?? [];
  const all = selected?.id === UNASSIGNED ? orphans : (projects ?? []).filter((p) => p.eventId === selected?.id);
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
      (!filters.mine || !wallet.address || p.ownerWallet?.toLowerCase() === wallet.address.toLowerCase()) &&
      (!needle || [p.name, p.teamName, p.pitch].some((x) => x.toLowerCase().includes(needle))),
  );
  const filtered = Boolean(filters.track || needle || (filters.mine && wallet.address));

  return (
    <>
      <div className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0">
            <SplitWords>Projects</SplitWords>
          </h1>
        </div>
        <Link to="/tournaments" className="btn btn--primary btn--arrow rise" style={{ "--i": 3 }}>
          Submit a project <span aria-hidden="true">→</span>
        </Link>
      </div>


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
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters({ track: "", q: "", mine: false })}>
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
                    <ReviewBadge review={p.review} />
                  </div>
                  <div>
                    <h3 className="t-display-md m0 fighter-card__name">{p.name}</h3>
                    <p className="t-caption m0">by {p.teamName}</p>
                    <EnsChip id={p.id} />
                  </div>
                  <p className="t-body m0 fighter-card__pitch">{p.twist || p.pitch}</p>
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
