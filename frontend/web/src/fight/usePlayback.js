/*
 * Playback clock over an ordered event list: a cursor (event index) plus
 * elapsed ms inside that event. Play, pause, speed and seek only move this
 * cursor; the fight state is always re-derived from events up to it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { eventDuration } from "./choreo.js";

export function usePlayback(events, { autoPlay = false, start = { index: 0, ms: 0 } } = {}) {
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
      if (end) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, events]);

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
