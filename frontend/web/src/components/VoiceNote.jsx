/*
 * Voice note for the judge form: record or upload audio, whisper-large-v3 on 0G
 * transcribes it, and the text is added to one of the persona's free-text fields.
 * The judge can edit it like anything they typed. We show the 0G request ID and
 * say "TEE verified" only when 0G reported it for this call.
 */
import { useEffect, useRef, useState } from "react";
import { upload } from "../lib/api.js";
import { CopyId, TeeStatus, usd } from "./ZeroGProof.jsx";

export const VOICE_TARGETS = [
  { value: "expectations", label: "What you expect" },
  { value: "background", label: "Background" },
  { value: "browniePoints", label: "Brownie points" },
  { value: "dealBreakers", label: "Deal-breakers" },
];
const MIME_CHOICES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
const pickMime = () => (typeof MediaRecorder === "undefined" ? null : MIME_CHOICES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "");

export function VoiceNote({ model, onText }) {
  const [target, setTarget] = useState("expectations");
  const [phase, setPhase] = useState("idle"); // idle | recording | sending
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const rec = useRef(null);
  const timer = useRef(null);
  const canRecord = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && pickMime() !== null;

  useEffect(
    () => () => {
      clearInterval(timer.current);
      rec.current?.stream?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function send(blob) {
    setPhase("sending");
    setError("");
    try {
      const r = await upload("/judges/voice-note", blob);
      setResult(r);
      if (r.text) onText(target, r.text);
      else setError("No speech was found in that recording.");
    } catch (e) {
      setError(e.message);
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    setError("");
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        const type = (mr.mimeType || mimeType || "audio/webm").split(";")[0];
        send(new Blob(chunks, { type }));
      };
      mr.start();
      rec.current = mr;
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setPhase("recording");
    } catch {
      setError("Couldn't use the microphone. Allow it in the browser, or upload a file instead.");
    }
  }

  const stop = () => rec.current?.state === "recording" && rec.current.stop();

  function pick(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return setError("That file is over 20 MB. Trim it or record a shorter note.");
    setResult(null);
    send(f);
  }

  return (
    <div className="voice card card--surface" aria-labelledby="voice-h">
      <div className="voice__head">
        <span id="voice-h" className="t-body-strong">
          Say it instead
        </span>
        <span className="t-caption">Talk for a minute about what you look for. {model ?? "whisper-large-v3"} on 0G turns it into text you can edit.</span>
      </div>
      <div className="voice__row">
        <label className="voice__target">
          <span className="t-caption">Add the text to</span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={phase !== "idle"}>
            {VOICE_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {phase === "recording" ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={stop}>
            ■ Stop and transcribe ({seconds} s)
          </button>
        ) : (
          canRecord && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={start} disabled={phase !== "idle"}>
              ● Record a voice note
            </button>
          )
        )}
        <label className={`btn btn--ghost btn--sm voice__upload ${phase !== "idle" ? "is-disabled" : ""}`}>
          Upload audio
          <input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac" onChange={pick} disabled={phase !== "idle"} className="visually-hidden" />
        </label>
      </div>
      <div role="status" aria-live="polite" className="voice__status">
        {phase === "recording" && <span className="t-caption">● Recording… speak now.</span>}
        {phase === "sending" && <span className="t-caption">Transcribing on 0G…</span>}
        {error && <span className="field__error">✕ {error}</span>}
        {result && phase === "idle" && (
          <div className="voice__proof">
            <span className="t-caption">
              {result.text ? `✓ Added ${result.text.split(/\s+/).length} words to "${VOICE_TARGETS.find((t) => t.value === target)?.label}".` : ""} Transcribed by {result.model} on 0G · {usd(result.costUsdMicro)}
            </span>
            <TeeStatus teeVerified={result.teeVerified} />
            <CopyId value={result.requestId} />
          </div>
        )}
      </div>
    </div>
  );
}
