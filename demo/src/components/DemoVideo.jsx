/*
 * The demo video on a project page.
 *   1. The provider's own player when the link is embeddable (YouTube, Loom, Vimeo, Drive).
 *   2. Otherwise our server's copy (uploads, Loom, direct files, HLS streams).
 * When both exist, a switch lets the viewer pick; our copy keeps working if the
 * original is taken down.
 */
import { useEffect, useState } from "react";
import { api, apiUrl } from "../lib/api.js";
import { embedUrl, fmtBytes, fmtSeconds, isUploadRef, uploadUrl } from "../lib/video.js";
import { Spinner } from "./Feedback.jsx";

const providerOf = (url) => {
  try {
    const h = new URL(url).hostname.replace(/^(www|m)\./, "");
    if (h === "loom.com") return "Loom";
    if (/youtube\.com$|^youtu\.be$/.test(h)) return "YouTube";
    if (/vimeo\.com$/.test(h)) return "Vimeo";
    if (h === "drive.google.com") return "Google Drive";
    return h;
  } catch {
    return null;
  }
};

const httpsHref = (raw) => {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

/** Our copy's facts, refreshed while the review is still saving it. */
function useSavedVideo(project) {
  const [saved, setSaved] = useState(project.savedVideo ?? null);
  // Only wait while the review (which saves the copy) is actually in flight, and never forever:
  // participants don't see the review status, and a not-started review would otherwise spin for good.
  const inFlight = project.review?.status === "queued" || project.review?.status === "reviewing";
  const [gaveUp, setGaveUp] = useState(false);
  const waiting = project.kind === "submitted" && !saved && inFlight && !gaveUp;
  useEffect(() => setSaved(project.savedVideo ?? null), [project.id, project.savedVideo]);
  useEffect(() => setGaveUp(false), [project.id]);
  useEffect(() => {
    if (!waiting) return undefined;
    let alive = true;
    const started = Date.now();
    const t = setInterval(async () => {
      if (Date.now() - started > 10 * 60 * 1000) {
        clearInterval(t);
        if (alive) setGaveUp(true);
        return;
      }
      const r = await api(`/projects/${encodeURIComponent(project.id)}/video`).catch(() => null);
      if (alive && r?.video) setSaved(r.video);
    }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [project.id, waiting]);
  return { saved, waiting };
}

/** Screenshots the team added instead of a video: one big, thumbnails to switch. */
function Gallery({ name, images }) {
  const [i, setI] = useState(0);
  const cur = images[Math.min(i, images.length - 1)];
  return (
    <section className="card stack rise" style={{ "--i": 2 }} aria-label="Demo screenshots">
      <div className="demo-src">
        <span className="t-label">Demo screenshots</span>
        <span className="t-caption t-num">
          {i + 1} of {images.length}
        </span>
      </div>
      <a className="gallery__main" href={cur} target="_blank" rel="noopener noreferrer" aria-label={`Open screenshot ${i + 1} full size`}>
        <img src={cur} alt={`${name} screenshot ${i + 1}`} />
      </a>
      {images.length > 1 && (
        <div className="gallery__thumbs" role="group" aria-label="Pick a screenshot">
          {images.map((src, n) => (
            <button key={src} type="button" className="gallery__thumb" aria-pressed={n === i} onClick={() => setI(n)} aria-label={`Show screenshot ${n + 1}`}>
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <span className="t-caption">No demo video: the team added screenshots instead.</span>
    </section>
  );
}

export function DemoVideo({ project: p }) {
  if (!p.videoUrl && p.demoImages?.length) return <Gallery name={p.name} images={p.demoImages} />;
  return <VideoPlayer project={p} />;
}

function VideoPlayer({ project: p }) {
  const { saved, waiting } = useSavedVideo(p);
  const uploaded = isUploadRef(p.videoUrl);
  const embed = uploaded ? null : embedUrl(p.videoUrl);
  const ours = saved?.saved ? apiUrl(saved.url) : uploaded ? uploadUrl(p.videoUrl) : null;
  const [mode, setMode] = useState(embed ? "embed" : "ours");
  const showEmbed = embed && (mode === "embed" || !ours);
  const provider = uploaded ? null : providerOf(p.videoUrl);
  // Only https links become clickable: older or local-only entries were never server-checked.
  const originalHref = uploaded ? null : httpsHref(p.videoUrl);

  return (
    <section className="card stack rise" style={{ "--i": 2 }} aria-label="Demo video">
      {embed && ours && (
        <div className="demo-src">
          <span className="t-label">Demo video</span>
          <div className="chips chips--tight" role="group" aria-label="Which player">
            <button type="button" className="chip" aria-pressed={mode === "embed"} onClick={() => setMode("embed")}>
              {provider} player
            </button>
            <button type="button" className="chip" aria-pressed={mode === "ours"} onClick={() => setMode("ours")}>
              Our copy
            </button>
          </div>
        </div>
      )}

      {showEmbed ? (
        <div className="video">
          <iframe src={embed} title={`${p.name} demo video`} allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      ) : ours ? (
        <div className="video">
          <video key={ours} src={ours} controls playsInline preload="metadata" aria-label={`${p.name} demo video`} />
        </div>
      ) : waiting ? (
        <div className="video video--empty">
          <div className="video__msg">
            <Spinner label="Saving a copy of the demo video" />
            <span className="t-body">Saving a copy of the demo video…</span>
          </div>
        </div>
      ) : (
        <p className="t-body m0">{saved?.reason ? `We couldn't show this video here: ${saved.reason}` : "This video can't be shown here."}</p>
      )}

      <div className="demo-src">
        <span className="t-caption">
          {uploaded
            ? `Uploaded by the team${saved?.seconds ? ` · ${fmtSeconds(saved.seconds)}` : ""}`
            : saved?.saved
              ? `Our copy saved · ${fmtSeconds(saved.seconds)} · ${fmtBytes(saved.bytes)}`
              : provider
                ? `Plays from ${provider}`
                : ""}
        </span>
        {!uploaded && originalHref && (
          <a className="t-caption" href={originalHref} target="_blank" rel="noopener noreferrer">
            Open the original ↗
          </a>
        )}
      </div>
    </section>
  );
}
