import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { bouncy } from "./fx.jsx";
import { fighterTraits } from "../lib/fighter.js";
import { Ring } from "./Arena.jsx";
import { useForm } from "./fields.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";
import { trackName } from "./Projects.jsx";

const REQUIRED = ["team.name", "project.name", "project.pitch", "project.description", "code.repoUrl", "demo.videoUrl"];

/**
 * Live preview: the fighter rebuilds as the team types. Gear earned from the
 * description pops on, and a short "new gear" note says why.
 */
export function FighterPreview() {
  const { data, errors } = useForm();
  const project = {
    seed: data.fighter?.seed,
    name: data.project.name.trim() || "Unnamed project",
    pitch: data.project.pitch,
    description: data.project.description,
    tracks: data.tracks.selected,
  };
  const gearIds = Object.values(fighterTraits(project).gear).map((g) => g.id);
  const items = fighterTraitItems(project, trackName);

  const prev = useRef(gearIds);
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    const added = gearIds.find((id) => !prev.current.includes(id));
    prev.current = gearIds;
    if (!added) return undefined;
    setFresh(items.find((i) => i.id === added)?.label ?? null);
    const t = setTimeout(() => setFresh(null), 2400);
    return () => clearTimeout(t);
    // gearIds is derived from data; join keeps the effect cheap and stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearIds.join("|")]);

  const ready = REQUIRED.filter((k) => !errors[k]).length;

  return (
    <aside className="preview" aria-label="Your fighter preview">
      <Ring className="preview__ring">
        <AnimatePresence>
          {fresh && (
            <motion.span
              key={fresh}
              className="gear-note"
              role="status"
              initial={{ opacity: 0, y: -16, scale: 0.6, rotate: -8 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotate: -3 }}
              exit={{ opacity: 0, y: -10, scale: 0.8 }}
              transition={bouncy}
            >
              ✦ New gear: {fresh}
            </motion.span>
          )}
        </AnimatePresence>
        <motion.span key={fresh ?? "idle"} className="preview__fighter" initial={fresh ? { y: 0 } : false} animate={fresh ? { y: [0, -18, 0, -5, 0] } : {}} transition={{ duration: 0.7 }}>
          <PixelFighter project={project} scale={9} />
        </motion.span>
      </Ring>
      <div className="preview__body">
        <div>
          <span className="t-label">Your fighter</span>
          <h2 className="t-display-md m0 preview__name">{project.name}</h2>
        </div>
        <ul className="traits">
          <AnimatePresence initial={false}>
            {items.map((i) => (
              <motion.li
                key={i.id}
                layout
                className="trait"
                initial={{ opacity: 0, x: -12, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 12 }}
                transition={bouncy}
              >
                <span className="trait__dot" aria-hidden="true" />
                <span className="trait__text">
                  <span className="t-body-strong">{i.label}</span>
                  <span className="t-caption">{i.why}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <p className="t-caption m0">Mention what you built in the description. Wearables, AI agents, payments, games, audio and privacy each earn gear.</p>
        <ReadyMeter ready={ready} total={REQUIRED.length} />
      </div>
    </aside>
  );
}

/** Segmented readiness meter: one pip per required field, filling with a spring. */
function ReadyMeter({ ready, total }) {
  const done = ready === total;
  return (
    <div className="ready" role="progressbar" aria-valuenow={ready} aria-valuemin={0} aria-valuemax={total} aria-label="Fields ready">
      <div className="ready__head">
        <span className="t-caption t-num">
          {ready} of {total} fields ready
        </span>
        <AnimatePresence>
          {done && (
            <motion.span className="ready__go" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: -4 }} exit={{ scale: 0 }} transition={bouncy}>
              Ready to fight
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="ready__pips">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="ready__pip">
            <motion.span className="ready__fill" initial={false} animate={{ scaleX: i < ready ? 1 : 0 }} transition={{ ...bouncy, delay: i < ready ? i * 0.03 : 0 }} />
          </span>
        ))}
      </div>
    </div>
  );
}
