import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { bouncy } from "./fx.jsx";
import { autoGear, fighterTraits, GEAR_RULES, GEAR_SLOTS, joinSeed, splitSeed } from "../lib/fighter.js";
import { FIGHTER_ROSTER } from "../lib/fighterRoster.js";
import { newSeed } from "../lib/form.js";
import { EVENT } from "../config/event.js";
import { Ring } from "./Arena.jsx";
import { useForm } from "./fields.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { trackNameOf } from "../lib/events.js";

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
    { id: "story", label: "Story", tip: "pitch + a solid description", next: "Write a longer description (about 500 characters)", v: (ok("project.pitch") ? 0.35 : 0) + Math.min(desc / 500, 1) * 0.65 },
    { id: "code", label: "Code", tip: "a public GitHub repo", next: "Add a public GitHub repo", v: ok("code.repoUrl") ? 1 : d.code.repoUrl.trim() ? 0.3 : 0 },
    { id: "demo", label: "Demo", tip: "a demo video (or screenshots), plus a live app", next: "Add a demo video and a live app link", v: (video ? (d.demo.source === "images" ? Math.min(0.55, 0.15 + shots * 0.1) : 0.7) : 0) + ((d.demo.liveUrl ?? "").trim() && ok("demo.liveUrl") ? 0.3 : 0) },
    { id: "reach", label: "Reach", tip: "sponsor tracks you enter", next: "Enter more sponsor tracks", v: 0.25 + (d.tracks.selected.length / EVENT.maxTracks) * 0.75 },
  ];
}

/**
 * Live fighter card: rebuilds as the team types. Pick a character, watch the
 * stats fill, and earn gear by describing what you built.
 */
export function FighterPreview({ eventName }) {
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
    if (added) setFresh(GEAR_RULES.find((r) => r.id === added)?.label ?? null);
    // equipped is derived from data; the joined ids keep the effect stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...equipped].join("|")]);
  // Its own timer, so a gear change inside the 2.4 s can't leave the note stuck on screen.
  useEffect(() => {
    if (!fresh) return undefined;
    const timer = setTimeout(() => setFresh(null), 2400);
    return () => clearTimeout(timer);
  }, [fresh]);

  const [dir, setDir] = useState(1);
  const cycle = (step) => {
    const next = FIGHTER_ROSTER[(idx + step + FIGHTER_ROSTER.length) % FIGHTER_ROSTER.length];
    const s = seedFor(next.id);
    if (!s) return;
    setDir(step);
    set("fighter.seed", joinSeed(s, splitSeed(data.fighter?.seed).gear));
  };

  const ready = REQUIRED.filter((k) => !errors[k]).length;
  const trim = t.jacketFrom ? `${trackNameOf(t.jacketFrom)} trim` : "Grey trim";

  return (
    <aside className="fightercard" aria-label="Your fighter preview">
      <div className="fightercard__band">
        <span className="fightercard__event">{eventName}</span>
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
      <Ring className="fightercard__ring">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.span
            key={t.archetype}
            className="fightercard__fighter"
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

      <div className="fightercard__picker">
        <button type="button" className="fightercard__arrow" onClick={() => cycle(-1)} aria-label="Previous character">
          ◀
        </button>
        <div className="fightercard__who" aria-live="polite">
          <span className="t-body-strong">{t.archetypeName}</span>
          <span className="t-caption">{t.archetypeDetail}</span>
        </div>
        <button type="button" className="fightercard__arrow" onClick={() => cycle(1)} aria-label="Next character">
          ▶
        </button>
      </div>

      <div className="fightercard__body">
        <div className="fightercard__title">
          <span className="t-label">Your fighter</span>
          <h2 className="t-display-md m0 preview__name">{project.name}</h2>
          <span className={`fightercard__trim ${t.jacketFrom ? "fightercard__trim--on" : ""}`} style={{ "--trim": t.jacket }}>
            {trim}
            <span className="t-caption"> · {t.jacketFrom ? "from your first track" : "pick a track to colour it"}</span>
          </span>
        </div>

        <StatsBlock list={stats(data, errors)} />

        <GearPicker project={project} seed={data.fighter?.seed} onPick={(seed) => set("fighter.seed", seed)} />

        <ReadyMeter ready={ready} total={REQUIRED.length} />
      </div>
    </aside>
  );
}

/** Four bars that fill as the form does, each saying what it measures, plus the one thing to do next. */
function StatsBlock({ list }) {
  const weakest = list.filter((s) => s.v < 0.99).sort((a, b) => a.v - b.v)[0];
  return (
    <div className="stack-xs">
      <span className="t-label">Stats · fill in the form to power up</span>
      <dl className="fstats">
        {list.map((s) => (
          <div key={s.id} className="fstat" title={`Grows with ${s.tip}`}>
            <dt className="t-label">{s.label}</dt>
            <dd className="fstat__bar">
              <motion.span className={`fstat__fill fstat__fill--${s.id}`} initial={false} animate={{ scaleX: Math.min(1, s.v) }} transition={bouncy} />
            </dd>
            <dd className="fstat__pct t-num">{Math.round(Math.min(1, s.v) * 100)}</dd>
          </div>
        ))}
      </dl>
      <p className="fstat__next m0">{weakest ? <>Next: {weakest.next}</> : "Maxed out. Nice."}</p>
    </div>
  );
}

/**
 * One item per slot. "Auto" lets the description choose (and says what it chose); any other
 * choice is the team's and travels with the fighter seed, so the arena draws the same fighter.
 */
function GearPicker({ project, seed, onPick }) {
  const { base, gear: picked } = splitSeed(seed);
  const auto = autoGear(project);
  const choose = (slot, value) => onPick(joinSeed(base, { ...picked, [slot]: value === "auto" ? undefined : value }));
  return (
    <div className="stack-xs">
      <span className="t-label">Gear · one per slot</span>
      <p className="gear__hint m0">✦ marks what your description suggests. Tap any item to swap it.</p>
      <div className="gear">
        {GEAR_SLOTS.map(({ slot, label }) => {
          const own = picked[slot];
          const current = own ?? auto[slot] ?? "none";
          const options = [...GEAR_RULES.filter((r) => r.slot === slot).map((r) => ({ value: r.id, name: r.label, why: r.why })), { value: "none", name: "None" }];
          return (
            <div key={slot} className="gear__row" role="radiogroup" aria-label={`${label} gear`}>
              <span className="gear__slot">{label}</span>
              <div className="gear__chips">
                {options.map((o) => {
                  const suggested = auto[slot] === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={current === o.value}
                      className={`gear__chip ${current === o.value ? "gear__chip--on" : ""}`}
                      title={suggested ? `Suggested: your description mentions ${o.why}` : o.why ? `Fits ${o.why}` : "Keep this slot empty"}
                      onClick={() => choose(slot, o.value)}
                    >
                      {suggested && <span className="gear__star" aria-label="suggested">✦</span>}
                      {o.name}
                    </button>
                  );
                })}
                {own && (
                  <button type="button" className="gear__reset" onClick={() => choose(slot, "auto")} title="Let your description choose again">
                    ↺ auto
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
