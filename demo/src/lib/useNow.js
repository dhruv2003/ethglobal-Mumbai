import { useEffect, useState } from "react";

/** The current time, refreshed once a second while `on` (so countdowns and elapsed times move). */
export function useNow(on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
