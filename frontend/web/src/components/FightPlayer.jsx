/* Plays a recorded fight: the ring, its controls and the latest lines said. Shared by the fight page and its full-screen view. */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Card, StatusPill } from "@ds/ui.jsx";
import { FightStage } from "../fight/FightStage.jsx";
import { stateAt } from "../fight/reducer.js";
import { CRITERION_LABEL, fmtHealth } from "../fight/score.js";
import { useFightSound } from "../fight/useFightSound.js";
import { eventDuration } from "../fight/choreo.js";
import { useReel } from "../fight/usePlayback.js";
import { prefersReducedMotion } from "../lib/motion.js";

const SAY = { pitch: "pitches", question: "asks", answer: "answers", challenge: "challenges", rebuttal: "replies", closing: "closes" };
const INTRO = { seq: 1, ts: new Date(0).toISOString(), type: "intro" };
const NOT_STARTED = stateAt([INTRO], INTRO.seq);

const fighterOf = (p) => ({ id: p.id, name: p.name, tracks: p.tracks ?? [], pitch: p.pitch, fighterSeed: p.fighterSeed, seed: p.seed });

export function matchFor(tournament, match, fight, a, b) {
  return {
    id: `${tournament.id}-${match.index}`,
    title: match.roundName,
    event: tournament.title,
    fighters: { a: fighterOf(a), b: fighterOf(b) },
    judges: fight?.judges ?? {},
  };
}

export const canPlay = (fight) => fight?.status === "done" && fight.events?.length > 0;

/** The ring before the fight: both fighters squared up, nothing said yet. */
export function WaitingRing({ match, fit }) {
  return <FightStage match={match} state={NOT_STARTED} event={INTRO} ms={eventDuration(INTRO)} reduced captions={false} typing={false} fit={fit} />;
}

export function Player({ fightMatch, events, fight, theater = false, onResult }) {
  const pb = useReel(events, { autoPlay: theater });
  // Tell the theater once the winner's banner has had a moment on screen.
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !onResult || pb.event?.type !== "result" || pb.ms < 1600) return;
    told.current = true;
    onResult(pb.event.winner);
  }, [pb.event, pb.ms, onResult]);
  const sound = useFightSound(events, pb);
  const state = useMemo(() => stateAt(events, events[pb.index].seq), [events, pb.index]);
  const [reduced] = useState(() => !!prefersReducedMotion());
  const lines = state.log.filter((e) => SAY[e.type]).slice(-4).reverse();
  const who = (e) => fightMatch.fighters[e.actor]?.name ?? `Judge ${fightMatch.judges[e.actor]?.name ?? ""}`;
  const proof = pb.event?.proof;

  const controls = (
      <div className="fight-controls">
        <button type="button" className="btn btn--secondary btn--sm" onClick={sound.togglePlay}>
          {pb.playing ? "Pause" : "Play"}
        </button>

        <span className="fight-round t-label">
          <span className="live-dot" aria-hidden="true" /> {state.result ? "Result" : state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}
          <span className="t-caption t-num">{Math.ceil(pb.leftMs / 1000)}s</span>
        </span>
        <span className="t-caption t-num fight-controls__health">
          {fmtHealth(state.health.a)} · {fmtHealth(state.health.b)} HP
        </span>
        <button type="button" className="fd__toggle" aria-pressed={!sound.muted} onClick={sound.toggleMute}>
          Sound
        </button>
      </div>
  );
  if (theater) {
    return (
      <>
        <div className="theater__stage">
          <FightStage match={fightMatch} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions typing={pb.playing} fit />
        </div>
        <div className="theater__controls">{controls}</div>
      </>
    );
  }
  return (
    <div className="stack">
      <FightStage match={fightMatch} state={state} event={pb.event} ms={pb.ms} reduced={reduced} captions typing={pb.playing} />
      {controls}
      <Card variant="surface" className="stack">
        <div className="section-head">
          <h2 className="t-heading m0">{state.round ? `${CRITERION_LABEL[state.round]} round` : "Opening pitches"}</h2>
          <StatusPill tone="reward">Judged on 0G</StatusPill>
        </div>
        {lines.length ? (
          <ol className="fight-lines">
            <AnimatePresence initial={false} mode="popLayout">
              {lines.map((e) => (
                <motion.li key={e.seq} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <span className="t-label">
                    {who(e)} {SAY[e.type]}
                  </span>
                  <span className="t-body">{e.text}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        ) : (
          <p className="t-body muted m0">Nothing said yet. Press play.</p>
        )}
        <p className="t-caption m0 t-mono">
          {proof?.requestId ? `0G request ${proof.requestId}${proof.teeVerified ? " · TEE verified" : ""}` : `${fight.calls ?? "Many"} 0G calls · ${fight.fighters?.a?.fighterName ?? "A"} vs ${fight.fighters?.b?.fighterName ?? "B"}`}
        </p>
      </Card>
    </div>
  );
}
