/*
 * "Hear the battle": plays a recorded fight's spoken lines one after another, in the
 * fighters' own voices (MiniMax speech on 0G, served by /api/arena/fights/:t/:m/voice/:seq).
 * Separate from the 30-second highlight reel: hearing every line takes minutes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const SPOKEN = new Set(["pitch", "question", "answer", "challenge", "rebuttal", "closing"]);

/** The events that have a voice line, in order. */
export const spokenLines = (events) => events.filter((e) => SPOKEN.has(e.type) && String(e.text ?? "").trim());

export function useFightVoice(fight, events) {
  const [current, setCurrent] = useState(null); // the line being spoken
  const [error, setError] = useState("");
  const run = useRef(0);
  const audioRef = useRef(null);
  const canSpeak = Boolean(fight?.tournamentId != null && fight?.match != null && events?.length);

  const stop = useCallback(() => {
    run.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    setCurrent(null);
  }, []);

  const play = useCallback(async () => {
    if (!canSpeak) return;
    const mine = ++run.current;
    setError("");
    for (const line of spokenLines(events)) {
      if (run.current !== mine) return;
      setCurrent(line);
      const audio = new Audio(`/api/arena/fights/${fight.tournamentId}/${fight.match}/voice/${line.seq}`);
      audioRef.current = audio;
      const ok = await new Promise((done) => {
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        audio.play().catch(() => done(false));
      });
      if (!ok && run.current === mine) {
        setError("The voice for this line couldn't play. The battle's voices need the 0G key on the server.");
        break;
      }
    }
    if (run.current === mine) setCurrent(null);
  }, [canSpeak, events, fight?.tournamentId, fight?.match]);

  useEffect(() => stop, [stop]); // leaving the page stops the voices

  return { canSpeak, speaking: Boolean(current), current, play, stop, error };
}
