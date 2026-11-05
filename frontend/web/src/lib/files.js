/* File checks for uploads (PRD SUB-02). Files stay in the browser until the backend exists. */
import { LIMITS } from "../config/event.js";
import { fmtSize } from "./validate.js";
import { newId } from "./form.js";

const KINDS = {
  image: { types: ["image/jpeg", "image/png", "image/webp"], ext: ["jpg", "jpeg", "png", "webp"], label: "JPG, PNG or WebP" },
  pdf: { types: ["application/pdf"], ext: ["pdf"], label: "PDF" },
  text: { types: ["text/plain", "text/markdown"], ext: ["txt", "md"], label: "text" },
  video: { types: ["video/mp4"], ext: ["mp4"], label: "MP4" },
};

export function kindOf(file) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  for (const [kind, k] of Object.entries(KINDS)) if (k.types.includes(file.type) || k.ext.includes(ext)) return kind;
  return null;
}

export const acceptFor = (kinds) => kinds.flatMap((k) => [...KINDS[k].types, ...KINDS[k].ext.map((e) => `.${e}`)]).join(",");

/** Returns { meta } or { error } naming the file that failed. */
export function checkFile(file, allowedKinds) {
  const kind = kindOf(file);
  if (!kind || !allowedKinds.includes(kind)) {
    const labels = allowedKinds.flatMap((k) => KINDS[k].label.split(/, | or /));
    const want = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : labels[0];
    return { error: `${file.name}: we only take ${want} here.` };
  }
  if (file.size > LIMITS[kind]) return { error: `${file.name} is ${fmtSize(file.size)}. The limit is ${fmtSize(LIMITS[kind])}.` };
  return {
    meta: {
      id: newId(),
      name: file.name,
      size: file.size,
      type: file.type || kind,
      kind,
      previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
    },
  };
}

/** Video length in seconds, or null if the browser can't read it. */
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    v.src = url;
  });
}

/* Raw File objects, kept out of form state so drafts stay serializable.
   The future upload step reads them from here by meta id. */
export const fileStore = new Map();
