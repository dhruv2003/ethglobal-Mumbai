import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { bouncy } from "./fx.jsx";
import { fighterTraits, GEAR_RULES } from "../lib/fighter.js";
import { FIGHTER_ROSTER } from "../lib/fighterRoster.js";
import { newSeed } from "../lib/form.js";
import { EVENT } from "../config/event.js";
import { Ring } from "./Arena.jsx";
import { useForm } from "./fields.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { trackName } from "./Projects.jsx";

const REQUIRED = ["team.name", "project.name", "project.pitch", "project.description", "code.repoUrl", "demo.videoUrl"];

/**
 * A seed that lands on roster[target]. The character comes from the seed, so
 * picking one never changes what the submission signs (fighterSeed only).
 */
function seedFor(targetId) {
  for (let i = 0; i < 400; i++) {
    const s = newSeed();
    if (fighterTraits({ seed: s }).archetype === targetId) return s;
  }
  return null;
}

/** 0..1 per stat, from what's filled in. Plain nudges, not scores. */
function stats(d, errors) {
  const ok = (k) => !errors[k];
  const desc = d.project.description.trim().length;
  const shots = (d.demo.images ?? []).length;
  const video = d.demo.source === "upload" ? Boolean(d.demo.upload?.ref) : d.demo.source === "images" ? shots > 0 : ok("demo.videoUrl");
  return [
    { id: "story", label: "Story", tip: "pitch + a solid description", v: (ok("project.pitch") ? 0.35 : 0) + Math.min(desc / 500, 1) * 0.65 },
    { id: "code", label: "Code", tip: "a public GitHub repo", v: ok("code.repoUrl") ? 1 : d.code.repoUrl.trim() ? 0.3 : 0 },
    { id: "demo", label: "Demo", tip: "a demo video (or screenshots), plus a live app", v: (video ? (d.demo.source === "images" ? Math.min(0.55, 0.15 + shots * 0.1) : 0.7) : 0) + ((d.demo.liveUrl ?? "").trim() && ok("demo.liveUrl") ? 0.3 : 0) },
    { id: "reach", label: "Reach", tip: "sponsor tracks you enter", v: 0.25 + (d.tracks.selected.length / EVENT.maxTracks) * 0.75 },
  ];
}

/**
 * Live fighter card: rebuilds as the team types. Pick a character, watch the
 * stats fill, and earn gear by describing what you built.
 */
export function FighterPreview() {
  const { data, errors, set } = useForm();
  const project = {
    seed: data.fighter?.seed,
    name: data.project.name.trim() || "Unnamed project",
    pitch: data.project.pitch,
    description: data.project.description,
    tracks: data.tracks.selected,
  };
  const t = fighterTraits(project);
  const equipped = new Set(Object.values(t.gear).map((g) => g.id));
  const idx = Math.max(0, FIGHTER_ROSTER.findIndex((r) => r.id === t.archetype));

  const prev = useRef([...equipped]);
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    const added = [...equipped].find((id) => !prev.current.includes(id));
    prev.current = [...equipped];
    if (!added) return undefined;
    setFresh(GEAR_RULES.find((r) => r.id === added)?.label ?? null);
    const timer = setTimeout(() => setFresh(null), 2400);
    return () => clearTimeout(timer);
    // equipped is derived from data; the joined ids keep the effect stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...equipped].join("|")]);

  const [dir, setDir] = useState(1);
  const cycle = (step) => {
    const next = FIGHTER_ROSTER[(idx + step + FIGHTER_ROSTER.length) % FIGHTER_ROSTER.length];
    const s = seedFor(next.id);
    if (!s) return;
    setDir(step);
    set("fighter.seed", s);
  };

  const ready = REQUIRED.filter((k) => !errors[k]).length;
  const trim = t.jacketFrom ? `${trackName(t.jacketFrom)} trim` : "Grey trim";

  return (
    <aside className="fcard" aria-label="Your fighter preview">
      <div className="fcard__band">
        <span className="fcard__event">{EVENT.name}</span>
        <span className="t-mono-caption">No. {String(t.seed % 1000).padStart(3, "0")}</span>
      </div>

      <AnimatePresence>
        {fresh && (
          <motion.span
            key={fresh}
            className="gear-note"
            role="status"
            initial={{ opacity: 0, y: -12, scale: 0.6, rotate: -8 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: -3 }}
            exit={{ opacity: 0, y: -8, scale: 0.8 }}
            transition={bouncy}
          >
            ✦ New gear: {fresh}
          </motion.span>
        )}
      </AnimatePresence>
      <Ring className="fcard__ring">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.span
            key={t.archetype}
            className="fcard__fighter"
            custom={dir}
            initial={{ opacity: 0, x: dir * 60, scale: 0.85 }}
            animate={{ opacity: 1, x: 0, scale: 1, y: fresh ? [0, -16, 0, -4, 0] : 0 }}
            exit={{ opacity: 0, x: dir * -60, scale: 0.85, transition: { duration: 0.15 } }}
            transition={bouncy}
          >
            <PixelFighter project={project} scale={9} />
          </motion.span>
        </AnimatePresence>
      </Ring>

      <div className="fcard__picker">
        <button type="button" className="fcard__arrow" onClick={() => cycle(-1)} aria-label="Previous character">
          ◀
        </button>
        <div className="fcard__who" aria-live="polite">
          <span className="t-body-strong">{t.archetypeName}</span>
          <span className="t-caption">{t.archetypeDetail}</span>
        </div>
        <button type="button" className="fcard__arrow" onClick={() => cycle(1)} aria-label="Next character">
          ▶
        </button>
      </div>

      <div className="fcard__body">
        <div className="fcard__title">
          <span className="t-label">Your fighter</span>
          <h2 className="t-display-md m0 preview__name">{project.name}</h2>
          <span className={`fcard__trim ${t.jacketFrom ? "fcard__trim--on" : ""}`} style={{ "--trim": t.jacket }}>
            {trim}
            <span className="t-caption"> · {t.jacketFrom ? "from your first track" : "pick a track to colour it"}</span>
          </span>
        </div>

        <dl className="fstats">
          {stats(data, errors).map((s) => (
            <div key={s.id} className="fstat" title={`Grows with ${s.tip}`}>
              <dt className="t-label">{s.label}</dt>
              <dd className="fstat__bar">
                <motion.span className={`fstat__fill fstat__fill--${s.id}`} initial={false} animate={{ scaleX: Math.min(1, s.v) }} transition={bouncy} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="stack-xs">
          <span className="t-label">
            Gear · {equipped.size} of {GEAR_RULES.length}
          </span>
          <ul className="gear-slots">
            {GEAR_RULES.map((r) => {
              const on = equipped.has(r.id);
              return (
                <motion.li
                  key={r.id}
                  className={`gear-slot ${on ? "gear-slot--on" : ""}`}
                  title={on ? `Earned: ${r.why}` : `Mention ${r.why} in your description`}
                  animate={on ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  <span className="gear-slot__mark" aria-hidden="true">
                    {on ? "✦" : "?"}
                  </span>
                  <span className="gear-slot__text">
                    <span className="gear-slot__name">{on ? r.label : "Locked"}</span>
                    <span className="gear-slot__why">{r.why}</span>
                  </span>
                </motion.li>
              );
            })}
          </ul>
        </div>

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
          {ready} of {total} required fields
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
