/*
 * Everything the Review tab shows, loaded once and shared by its sub-tabs:
 * the judges' result (polled while a judging run is going), the fact-check
 * dossier and the backend's health. Reloads when the pipeline moves on.
 */
import { useCallback, useEffect, useState } from "react";
import { api, health } from "../../lib/api.js";

export function useReviewData(project, live) {
  const id = encodeURIComponent(project.id);
  const [data, setData] = useState({
    loaded: false,
    health: null,
    result: project.reviews ?? null,
    running: false,
    progress: null,
    dossier: project.dossier ?? null,
    zgStorage: null,
  });
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  // Reload when a step that produces data finishes, or the whole run does.
  const steps = live?.state?.steps ?? [];
  const st = (sid) => steps.find((s) => s.id === sid)?.status ?? "";
  const key = `${live?.state?.finishedAt ?? ""}|${st("dossier")}|${st("judges")}|${st("live")}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await health();
      const [r, d] = h
        ? await Promise.all([api(`/projects/${id}/reviews`).catch(() => null), project.kind === "submitted" ? api(`/projects/${id}/dossier`).catch(() => null) : null])
        : [null, null];
      if (!alive) return;
      setData((x) => ({
        loaded: true,
        health: h,
        result: r?.result ?? x.result,
        running: Boolean(r?.running),
        progress: r?.progress ?? null,
        dossier: d?.dossier ?? x.dossier,
        zgStorage: r?.zgStorage ?? x.zgStorage ?? null,
      }));
    })();
    return () => {
      alive = false;
    };
  }, [id, project.kind, key]);

  // While the judges are at work, poll so each answer shows up as it lands.
  useEffect(() => {
    if (!data.running) return undefined;
    let alive = true;
    const started = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - started > 10 * 60 * 1000) return clearInterval(t);
      const r = await api(`/projects/${id}/reviews`).catch(() => null);
      if (!alive || !r) return;
      setData((x) => ({ ...x, running: r.running, progress: r.progress, result: r.running ? x.result : (r.result ?? x.result), zgStorage: r.zgStorage ?? x.zgStorage }));
      if (!r.running && r.progress?.error) setError(r.progress.error);
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [data.running, id]);

  const ask = useCallback(async () => {
    setAsking(true);
    setError("");
    try {
      const r = await api(`/projects/${id}/reviews`, { method: "POST" });
      setData((x) => ({ ...x, result: r.result, running: false, zgStorage: r.zgStorage ?? x.zgStorage }));
    } catch (e) {
      setError(e.message);
    } finally {
      setAsking(false);
    }
  }, [id]);

  return { ...data, asking, error, ask };
}

/** Score bands, shared by every view so the same number always gets the same word. */
export const band = (n) => (n == null ? "none" : n >= 70 ? "high" : n >= 50 ? "mid" : "low");
export const BAND_WORD = { high: "Strong", mid: "Promising", low: "Needs work", none: "Not scored" };

/** Judge identity colours: validated categorical trio (fixed order, never cycled). */
export const JUDGE_TONES = ["crush", "oracle", "amber"];

export const CRITERIA = {
  product_journey: "Product journey",
  real_world_value: "Real-world value",
  ui_ux: "UI / UX",
  code_quality: "Code quality",
  sdlc: "SDLC practices",
  feasibility: "Feasibility",
  scalability: "Scalability",
  business_model: "Business model",
  brownie_points: "Brownie points",
};

/** Fact-check claim statuses, in the order they're drawn. Each carries a mark and a word. */
export const CLAIM = [
  { id: "supported_by_code", mark: "✓", word: "Supported", tone: "good" },
  { id: "submitted_claim", mark: "”", word: "Team's word", tone: "info" },
  { id: "unverified", mark: "?", word: "Unverified", tone: "meh" },
  { id: "contradicted", mark: "✕", word: "Contradicted", tone: "bad" },
];

export const secs = (a, b) => Math.max(0, Math.round((Date.parse(b ?? new Date().toISOString()) - Date.parse(a)) / 1000));
export const fmt = (sec) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`);
