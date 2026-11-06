/*
 * "Meet the fighters": a round avatar per side under the ring. Hover, focus or tap one for a
 * short card about the project, so a visitor knows who they're watching before they bet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePoll } from "../lib/chain.js";
import { trackNameOf } from "../lib/events.js";
import { listProjects } from "../lib/projects.js";
import { Link } from "../lib/router.jsx";
import { PixelFighter, fighterTraitItems } from "./PixelFighter.jsx";

const short = (s, n) => (s && s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

function Fighter({ project, side }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // opened by a click/tap: stays until dismissed
  const ref = useRef(null);
  const persona = useMemo(() => fighterTraitItems(project, trackNameOf).find((x) => x.id === "archetype"), [project]);
  const id = `fi-${side}`;

  useEffect(() => {
    if (!pinned) return undefined;
    const away = (e) => !ref.current?.contains(e.target) && (setPinned(false), setOpen(false));
    const esc = (e) => e.key === "Escape" && (setPinned(false), setOpen(false));
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [pinned]);

  const about = project.description || project.pitch;
  const team = project.teamName || project.team?.name;
  return (
    <div ref={ref} className={`fi fi--${side}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button
        type="button"
        className="fi__btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => !pinned && !ref.current?.contains(e.relatedTarget) && setOpen(false)}
      >
        <span className="fi__avatar">
          <PixelFighter project={project} scale={2} label={project.name} />
        </span>
        <span className="fi__who">
          <b>{project.name}</b>
          <small>{persona?.label ?? "Fighter"} · tap for the story</small>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="dialog"
            aria-label={`About ${project.name}`}
            className="fi__pop"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
          >
            <span className="fi__side">{side === "a" ? "Blue corner" : "Orange corner"}</span>
            <h3 className="m0">{project.name}</h3>
            {team && team !== project.name && <p className="fi__team m0">by {team}</p>}
            {project.pitch && <p className="fi__pitch m0">{project.pitch}</p>}
            {about && about !== project.pitch && <p className="fi__about m0">{short(about, 260)}</p>}
            {persona && (
              <p className="fi__persona m0">
                <b>{persona.label}</b> {persona.why}
              </p>
            )}
            {project.tracks?.length > 0 && (
              <ul className="fi__tracks m0">
                {project.tracks.map((t) => (
                  <li key={t}>{trackNameOf(t)}</li>
                ))}
              </ul>
            )}
            {project.registered !== false && project.id && (
              <Link className="fi__link" to={`/projects/${encodeURIComponent(project.id)}`}>
                See the project and its review →
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Both fighters. Bracket slots on chain carry only a pitch, so fill in the rest from the submissions. */
export function FighterIntro({ a, b }) {
  const { data: projects } = usePoll(() => listProjects().catch(() => []), [], 60000, { key: "projects" });
  const full = (p) => ({ ...(projects?.find((x) => x.id === p.id) ?? {}), ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== "")) });
  return (
    <section className="fintro" aria-label="Meet the fighters">
      <span className="fintro__h">Meet the fighters</span>
      <div className="fintro__row">
        <Fighter project={full(a)} side="a" />
        <span className="fintro__vs" aria-hidden="true">
          vs
        </span>
        <Fighter project={full(b)} side="b" />
      </div>
    </section>
  );
}
