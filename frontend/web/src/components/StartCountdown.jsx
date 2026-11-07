/*
 * The last five seconds before a fight: 5, 4, 3, 2, 1, then "Fight!" over the ring.
 * Shows only inside that window; stays on "Fight!" until the replay takes over.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../lib/motion.js";

const WINDOW_MS = 5500;

export function StartCountdown({ at }) {
  const [now, setNow] = useState(() => Date.now());
  const left = at ? at - now : Infinity;
  const active = left <= WINDOW_MS && left > -15000;
  useEffect(() => {
    if (!at) return undefined;
    // Tick slowly while far away, every frame-ish once the last seconds start.
    const t = setInterval(() => setNow(Date.now()), left <= WINDOW_MS + 1000 ? 100 : 1000);
    return () => clearInterval(t);
  }, [at, left <= WINDOW_MS + 1000]);
  if (!active) return null;
  const n = Math.max(0, Math.ceil(left / 1000));
  const word = n === 0 ? "Fight!" : String(n);
  const calm = prefersReducedMotion();
  return (
    <div className="kickoff" role="status" aria-live="assertive">
      <span className="kickoff__label">{n === 0 ? "Match starting" : "Match starts in"}</span>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={word}
          className={`kickoff__n ${n === 0 ? "kickoff__n--go" : ""}`}
          initial={calm ? { opacity: 0 } : { opacity: 0, scale: 2.2, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 30 }}
          transition={{ type: "spring", stiffness: 520, damping: 22 }}
        >
          {word}
        </motion.span>
      </AnimatePresence>
      <span className="kickoff__dots" aria-hidden="true">
        {[5, 4, 3, 2, 1].map((k) => (
          <i key={k} className={n < k ? "on" : ""} />
        ))}
      </span>
    </div>
  );
}
