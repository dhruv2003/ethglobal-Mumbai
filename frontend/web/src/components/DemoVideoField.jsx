/*
 * Demo video: paste a link OR upload a file from this computer.
 * Uploads go to our server straight away (with progress), so the signed
 * submission only carries the file's server ref ("upload:<sha256>.<ext>").
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { uploadVideo, VIDEO_MAX_MB } from "../lib/api.js";
import { embedUrl, fmtBytes, fmtSeconds, linkPlan } from "../lib/video.js";
import { fieldId, Msg, useForm } from "./fields.jsx";
import { DemoImagesField } from "./DemoImagesField.jsx";

const OK_TYPE = /^video\/(mp4|webm|quicktime|x-m4v)$/;
const OK_NAME = /\.(mp4|mov|webm|m4v)$/i;

export function DemoVideoField() {
  const { get, set, errors, touched, touch, showAll } = useForm();
  const source = get("demo.source") ?? "link";
  const link = get("demo.videoUrl") ?? "";
  const upload = get("demo.upload");
  const [job, setJob] = useState(null); // { name, bytes, progress } while uploading
  const [problem, setProblem] = useState(null);
  const [localUrl, setLocalUrl] = useState(null); // object URL: instant preview before the server has it
  const [dragging, setDragging] = useState(false);
  const ctl = useRef(null);
  const id = fieldId("demo.videoUrl");
  const error = problem ?? (touched["demo.videoUrl"] || showAll ? errors["demo.videoUrl"] : undefined);

  useEffect(() => () => localUrl && URL.revokeObjectURL(localUrl), [localUrl]);
  useEffect(() => () => ctl.current?.abort(), []);

  const choose = (next) => {
    if (next === source) return;
    setProblem(null);
    set("demo.source", next);
  };

  const pick = async (file) => {
    if (!file) return;
    setProblem(null);
    if (!OK_TYPE.test(file.type) && !OK_NAME.test(file.name)) return setProblem("Pick an MP4, MOV or WebM video.");
    if (file.size > VIDEO_MAX_MB * 1048576) return setProblem(`That file is ${fmtBytes(file.size)}. The limit is ${VIDEO_MAX_MB} MB.`);
    ctl.current?.abort();
    // Keep the good upload until the replacement has landed: a failed replace must not lose it.
    const before = upload ?? null;
    setLocalUrl(URL.createObjectURL(file));
    set("demo.upload", null);
    setJob({ name: file.name, bytes: file.size, progress: 0 });
    const c = uploadVideo(file, (p) => setJob((j) => j && { ...j, progress: p }));
    ctl.current = c;
    try {
      const r = await c.done;
      set("demo.upload", { ref: r.ref, url: r.url, name: file.name, bytes: r.bytes, seconds: r.seconds });
      touch("demo.videoUrl");
    } catch (e) {
      if (!e.aborted) {
        setProblem(e.message);
        if (before) set("demo.upload", before);
      }
      setLocalUrl(null);
    } finally {
      if (ctl.current === c) ctl.current = null;
      setJob(null);
    }
  };

  const remove = () => {
    ctl.current?.abort();
    setLocalUrl(null);
    set("demo.upload", null);
  };

  const embed = source === "link" ? embedUrl(link) : null;
  const plan = source === "link" ? linkPlan(link) : null;
  const playUrl = localUrl ?? upload?.url ?? null;

  return (
    <div className="field demo-field">
      <div className="demo-field__head">
        <label htmlFor={source === "link" ? id : source === "images" ? `${id}-images` : `${id}-file`}>Demo</label>
        <div className="chips chips--tight" role="group" aria-label="How to add your demo">
          <button type="button" className="chip" aria-pressed={source === "link"} onClick={() => choose("link")}>
            Paste a link
          </button>
          <button type="button" className="chip" aria-pressed={source === "upload"} onClick={() => choose("upload")}>
            Upload a video
          </button>
          <button type="button" className="chip" aria-pressed={source === "images"} onClick={() => choose("images")}>
            No video? Screenshots
          </button>
        </div>
      </div>

      {source === "link" ? (
        <>
          <input
            id={id}
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://www.loom.com/share/… or https://youtu.be/…"
            autoCapitalize="off"
            spellCheck={false}
            value={link}
            onChange={(e) => set("demo.videoUrl", e.target.value)}
            onBlur={() => touch("demo.videoUrl")}
            aria-invalid={!!error}
            aria-describedby={`${id}-msg`}
          />
          <Msg id={`${id}-msg`} error={error} help={plan ?? "2 to 4 minutes. Loom, YouTube, Vimeo, Google Drive or a direct video file."} />
          <AnimatePresence initial={false}>
            {embed && (
              <motion.div className="video demo-field__preview" key={embed} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <iframe src={embed} title="Demo video preview" allow="fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : source === "images" ? (
        <>
          <DemoImagesField id={`${id}-images`} error={error} onProblem={setProblem} />
          <Msg id={`${id}-images-msg`} error={error} help="Show the main screens in the order a user sees them. Without a video we can't replay your demo, so the live test checks your main flows instead." />
        </>
      ) : (
        <>
          {!job && !upload ? (
            <label
              className={`dropzone ${dragging ? "dropzone--over" : ""} ${error ? "dropzone--error" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pick(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                id={`${id}-file`}
                className="visually-hidden"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
                onChange={(e) => pick(e.target.files?.[0])}
                aria-describedby={`${id}-msg`}
              />
              <span className="dropzone__icon" aria-hidden="true">
                ▶
              </span>
              <span className="t-body-strong">Drop your demo video here, or choose a file</span>
              <span className="t-caption">MP4, MOV or WebM · up to {VIDEO_MAX_MB} MB</span>
            </label>
          ) : (
            <div className="upload-card">
              {playUrl && <video className="upload-card__video" src={playUrl} controls muted playsInline preload="metadata" aria-label="Your demo video" />}
              <div className="upload-card__info">
                <span className="t-body-strong upload-card__name">{job?.name ?? upload?.name ?? "Your video"}</span>
                {job ? (
                  <>
                    <div className="progress" role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
                      <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
                    </div>
                    <span className="t-caption">
                      Uploading… {Math.round(job.progress * 100)}% of {fmtBytes(job.bytes)}
                    </span>
                  </>
                ) : (
                  <span className="t-caption">
                    ✓ Uploaded · {fmtBytes(upload.bytes)}
                    {upload.seconds ? ` · ${fmtSeconds(upload.seconds)}` : ""}. We transcribe it after you submit.
                  </span>
                )}
                <div className="upload-card__actions">
                  {job ? (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={remove}>
                      Cancel
                    </button>
                  ) : (
                    <>
                      <label className="btn btn--secondary btn--sm">
                        Replace
                        <input className="visually-hidden" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" onChange={(e) => pick(e.target.files?.[0])} />
                      </label>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={remove}>
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          <Msg id={`${id}-msg`} error={error} help={!job && !upload ? "2 to 4 minutes. It's stored on our server and shown on your project page." : undefined} />
        </>
      )}
    </div>
  );
}
