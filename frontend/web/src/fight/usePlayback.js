/*
 * Playback clock over an ordered event list: a cursor (event index) plus
 * elapsed ms inside that event. Play, pause, speed and seek only move this
 * cursor; the fight state is always re-derived from events up to it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eventDuration } from "./choreo.js";

/** live: more events are still coming, so reaching the end waits for them instead of stopping. */
export function usePlayback(events, { autoPlay = false, start = { index: 0, ms: 0 }, live = false } = {}) {
  const [pos, setPos] = useState(start);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(1);
  const ref = useRef({ pos, speed });
  ref.current.speed = speed;

  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(100, now - last); // a background tab shouldn't skip half a round
      last = now;
      let { index, ms } = ref.current.pos;
      ms += dt * ref.current.speed;
      while (index < events.length - 1 && ms >= eventDuration(events[index])) {
        ms -= eventDuration(events[index]);
        index += 1;
      }
      const end = index === events.length - 1 && ms >= eventDuration(events[index]);
      if (end) ms = eventDuration(events[index]);
      const next = { index, ms };
      ref.current.pos = next;
      setPos(next);
      if (end && !live) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, events, live]);

  const seek = useCallback(
    (index) => {
      const next = { index: Math.max(0, Math.min(events.length - 1, index)), ms: 0 };
      ref.current.pos = next;
      setPos(next);
    },
    [events.length],
  );

  const toggle = useCallback(() => {
    setPlaying((p) => {
      // Replay from the top once the match has ended.
      const { index, ms } = ref.current.pos;
      if (!p && index === events.length - 1 && ms >= eventDuration(events[index])) seek(0);
      return !p;
    });
  }, [events, seek]);

  return { index: pos.index, ms: pos.ms, event: events[pos.index], playing, toggle, speed, setSpeed, seek };
}

const REEL_MS = 30000; // a whole fight, start to result, never takes longer than this
const INTRO_MS = 1200;
const RESULT_MS = 2200;
const HIGHLIGHT = new Set(["ruling", "penalty", "point"]);

/**
 * The fight as a short highlight reel: the intro, every moment that moves the health bars
 * (rulings and penalties), then the result, squeezed into `totalMs`. Each slot plays its event's
 * animation sped up to fit. `index` points into the full event list, so the fight state
 * (health, scores, winner) is always the real one up to that moment.
 */
export function reelSlots(events, totalMs = REEL_MS) {
  const last = events.length - 1;
  const middle = events.map((e, i) => i).filter((i) => i > 0 && i < last && HIGHLIGHT.has(events[i].type));
  const picks = middle.length ? middle : events.map((e, i) => i).filter((i) => i > 0 && i < last && events[i].type === "round_sealed");
  const each = picks.length ? (totalMs - INTRO_MS - RESULT_MS) / picks.length : 0;
  const slots = [{ index: 0, dur: picks.length ? INTRO_MS : totalMs - RESULT_MS }, ...picks.map((index) => ({ index, dur: each }))];
  if (last > 0) slots.push({ index: last, dur: RESULT_MS });
  return slots;
}

export function useReel(events, { autoPlay = false, totalMs = REEL_MS } = {}) {
  const slots = useMemo(() => reelSlots(events, totalMs), [events, totalMs]);
  const [pos, setPos] = useState({ slot: 0, t: 0 });
  const [playing, setPlaying] = useState(autoPlay);
  const ref = useRef(pos);

  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      let { slot, t } = ref.current;
      t += dt;
      while (slot < slots.length - 1 && t >= slots[slot].dur) {
        t -= slots[slot].dur;
        slot += 1;
      }
      const end = slot === slots.length - 1 && t >= slots[slot].dur;
      if (end) t = slots[slot].dur;
      ref.current = { slot, t };
      setPos(ref.current);
      if (end) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, slots]);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      const { slot, t } = ref.current;
      if (!p && slot === slots.length - 1 && t >= slots[slot].dur) {
        ref.current = { slot: 0, t: 0 };
        setPos(ref.current);
      }
      return !p;
    });
  }, [slots]);

  /** Carry on from a given event, for a fight that was just being watched live. */
  const playFrom = useCallback(
    (eventIndex) => {
      const slot = slots.findIndex((s) => s.index >= eventIndex);
      ref.current = { slot: slot < 0 ? slots.length - 1 : slot, t: 0 };
      setPos(ref.current);
      setPlaying(true);
    },
    [slots],
  );

  const { index, dur } = slots[pos.slot];
  const event = events[index];
  const ms = dur ? (pos.t / dur) * eventDuration(event) : 0;
  const leftMs = slots.slice(pos.slot).reduce((s, x) => s + x.dur, 0) - pos.t;
  return { index, ms, event, playing, toggle, leftMs, playFrom };
}
