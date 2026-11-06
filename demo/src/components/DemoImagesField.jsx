/*
 * No video? Up to 8 screenshots instead. Each uploads on its own (with
 * progress) and the signed submission carries their server refs, in order.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { apiUrl, IMAGE_MAX_MB, MAX_IMAGES, uploadImage } from "../lib/api.js";
import { fmtBytes } from "../lib/video.js";
import { bouncy } from "./fx.jsx";
import { useForm } from "./fields.jsx";

const OK = /^image\/(png|jpeg|webp)$/;
const ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

export function DemoImagesField({ id, error, onProblem }) {
  const { get, set, touch } = useForm();
  const images = get("demo.images") ?? [];
  const [pending, setPending] = useState([]); // { key, name, preview, progress }
  const [dragging, setDragging] = useState(false);
  const latest = useRef(images);
  latest.current = images;
  const jobs = useRef(new Map());

  useEffect(() => () => jobs.current.forEach((c) => c.abort()), []);

  const add = (fileList) => {
    onProblem(null);
    const room = MAX_IMAGES - images.length - pending.length;
    const files = [...(fileList ?? [])];
    if (!files.length) return;
    if (room <= 0) return onProblem(`That's ${MAX_IMAGES} screenshots. Remove one to add another.`);
    const bad = files.find((f) => !OK.test(f.type));
    if (bad) return onProblem(`${bad.name} isn't a PNG, JPEG or WebP image.`);
    const big = files.find((f) => f.size > IMAGE_MAX_MB * 1048576);
    if (big) return onProblem(`${big.name} is ${fmtBytes(big.size)}. The limit is ${IMAGE_MAX_MB} MB per image.`);
    if (files.length > room) onProblem(`Only the first ${room} were added: the limit is ${MAX_IMAGES}.`);

    for (const file of files.slice(0, room)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      const preview = URL.createObjectURL(file);
      setPending((p) => [...p, { key, name: file.name, preview, progress: 0 }]);
      const c = uploadImage(file, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
      jobs.current.set(key, c);
      c.done
        .then((r) => {
          // Uploads can finish together: build on the newest list, not this render's.
          // The ref is the image's hash: the same screenshot twice is one entry.
          if (latest.current.some((i) => i.ref === r.ref)) return;
          latest.current = [...latest.current, { ref: r.ref, url: apiUrl(r.url), name: file.name, bytes: r.bytes }];
          set("demo.images", latest.current);
          touch("demo.videoUrl");
        })
        .catch((e) => !e.aborted && onProblem(`${file.name}: ${e.message}`))
        .finally(() => {
          jobs.current.delete(key);
          URL.revokeObjectURL(preview);
          setPending((p) => p.filter((x) => x.key !== key));
        });
    }
  };

  const remove = (ref) => set("demo.images", images.filter((i) => i.ref !== ref));
  const move = (i, step) => {
    const j = i + step;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    set("demo.images", next);
  };

  const full = images.length + pending.length >= MAX_IMAGES;

  return (
    <div className="shots">
      {(images.length > 0 || pending.length > 0) && (
        <ol className="shots__grid" aria-label="Your screenshots">
          <AnimatePresence initial={false}>
            {images.map((img, i) => (
              <motion.li key={img.ref} className="shot" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={bouncy}>
                <img src={img.url} alt={`Screenshot ${i + 1}: ${img.name}`} loading="lazy" />
                <span className="shot__n t-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="shot__tools">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move screenshot ${i + 1} earlier`}>
                    ◀
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label={`Move screenshot ${i + 1} later`}>
                    ▶
                  </button>
                  <button type="button" onClick={() => remove(img.ref)} aria-label={`Remove screenshot ${i + 1}`}>
                    ✕
                  </button>
                </div>
              </motion.li>
            ))}
            {pending.map((p) => (
              <motion.li key={p.key} className="shot shot--pending" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <img src={p.preview} alt="" />
                <div className="shot__progress" role="progressbar" aria-label={`Uploading ${p.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress * 100)}>
                  <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {!full && (
        <label
          className={`dropzone ${images.length ? "dropzone--slim" : ""} ${dragging ? "dropzone--over" : ""} ${error ? "dropzone--error" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
        >
          <input id={id} className="visually-hidden" type="file" multiple accept={ACCEPT} onChange={(e) => (add(e.target.files), (e.target.value = ""))} aria-describedby={`${id}-msg`} />
          <span className="dropzone__icon dropzone__icon--sunny" aria-hidden="true">
            ▦
          </span>
          <span className="t-body-strong">{images.length ? "Add more screenshots" : "Drop screenshots here, or choose files"}</span>
          <span className="t-caption">
            PNG, JPEG or WebP · up to {MAX_IMAGES}, {IMAGE_MAX_MB} MB each · {images.length + pending.length} of {MAX_IMAGES}
          </span>
        </label>
      )}
    </div>
  );
}
