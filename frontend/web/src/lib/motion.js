/* Small motion helpers. Every one of them respects prefers-reduced-motion. */
import { useEffect, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Count from 0 to `target` with an ease-out curve. Non-numbers pass straight through. */
export function useCountUp(target, ms = 700) {
  const numeric = typeof target === "number" && Number.isFinite(target);
  const [v, setV] = useState(numeric && !prefersReducedMotion() ? 0 : target);
  useEffect(() => {
    if (!numeric || prefersReducedMotion()) {
      setV(target);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, numeric]);
  return v;
}
