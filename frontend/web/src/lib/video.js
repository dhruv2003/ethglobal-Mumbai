/*
 * Demo videos: how a link plays, and what the server does with it.
 * Mirrors backend/src/reviewer/media.mjs classifyVideo.
 *
 *   embed  - the provider's own player (YouTube, Loom, Vimeo, Google Drive)
 *   saved  - the server keeps a copy (uploads, Loom, direct files, HLS)
 */

const parse = (raw) => {
  try {
    const u = new URL(String(raw).trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
};

/** The provider's embeddable player URL, or null. */
export function embedUrl(raw) {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "loom.com") {
    const id = u.pathname.match(/\/(?:share|embed)\/([a-f0-9]+)/)?.[1];
    return id ? `https://www.loom.com/embed/${id}` : null;
  }
  if (host === "youtu.be") return u.pathname.length > 1 ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}` : null;
  if (host === "youtube.com") {
    const id = u.searchParams.get("v") ?? u.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/\/(?:video\/)?(\d+)/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  if (host === "drive.google.com") {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1] ?? u.searchParams.get("id");
    return id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` : null;
  }
  return null;
}

/** One line telling the team what will happen to this link. */
export function linkPlan(raw) {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "loom.com") return "Plays from Loom. We also save a copy and read its captions.";
  if (/youtube\.com$|^youtu\.be$/.test(host)) return "Plays from YouTube. We can't save a copy, so it won't be transcribed. Upload the file if you want that.";
  if (/vimeo\.com$/.test(host)) return "Plays from Vimeo. We can't save a copy, so it won't be transcribed.";
  if (host === "drive.google.com") return "Plays from Google Drive (share it with 'anyone with the link'). Upload the file if you want it transcribed.";
  if (/\.(mp4|mov|webm|m4v|m3u8)$/i.test(u.pathname) || host === "stream.mux.com") return "We save a copy and play it from our server.";
  return "If this is a direct video file we save a copy; otherwise we link to it.";
}

export const isUploadRef = (v) => /^upload:[0-9a-f]{64}\.(mp4|mov|webm)$/.test(String(v ?? ""));
export const isImageRef = (v) => /^upload:[0-9a-f]{64}\.(png|jpg|webp)$/.test(String(v ?? ""));
export const uploadUrl = (ref) => (isUploadRef(ref) || isImageRef(ref) ? `/api/uploads/${ref.slice("upload:".length)}` : null);

export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 100 * 1048576 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const fmtSeconds = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
