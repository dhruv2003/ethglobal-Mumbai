/*
 * Validation for the submission form. Pure: (data, context) -> { errors }.
 * Keys are field paths, in on-screen order, so the first key is the first problem.
 */
import { EVENT } from "../config/event.js";

export const isHttpsUrl = (v) => {
  try {
    return new URL(String(v).trim()).protocol === "https:";
  } catch {
    return false;
  }
};

export const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/?$/;

/** Character limits shown as counters on the form. */
export const LIMITS = { teamName: 60, projectName: 60, pitch: 140, description: 5000 };

const blank = (v) => !String(v ?? "").trim();

export function validate(d, { walletAddress = "", tracks } = {}) {
  const errors = {};
  const req = (path, v, msg) => {
    if (blank(v)) errors[path] = msg;
  };
  const max = (path, v, n) => {
    if (!errors[path] && String(v ?? "").length > n) errors[path] = `Keep it under ${n} characters.`;
  };

  req("team.name", d.team.name, "Give your team a name.");
  max("team.name", d.team.name, LIMITS.teamName);

  req("project.name", d.project.name, "Give your project a name.");
  max("project.name", d.project.name, LIMITS.projectName);

  req("project.pitch", d.project.pitch, "Add a one-line pitch.");
  max("project.pitch", d.project.pitch, LIMITS.pitch);

  req("project.description", d.project.description, "Say what it does and how it's built.");
  max("project.description", d.project.description, LIMITS.description);

  const repo = d.code.repoUrl.trim();
  if (!repo) errors["code.repoUrl"] = "Add your public GitHub repository.";
  else if (!GITHUB_REPO.test(repo)) errors["code.repoUrl"] = "Use a GitHub repo link, like https://github.com/team/project.";

  if (d.demo.source === "images") {
    const n = (d.demo.images ?? []).filter((i) => i?.ref).length;
    if (!n) errors["demo.videoUrl"] = "Add at least one screenshot, or switch to a video.";
    else if (n > 8) errors["demo.videoUrl"] = "Keep it to 8 screenshots.";
  } else if (d.demo.source === "upload") {
    if (!d.demo.upload?.ref) errors["demo.videoUrl"] = "Upload your demo video, or switch to a link.";
  } else {
    const video = d.demo.videoUrl.trim();
    if (!video) errors["demo.videoUrl"] = "Add a link to your demo video.";
    else if (!isHttpsUrl(video)) errors["demo.videoUrl"] = "Use an https:// link.";
  }

  const live = (d.demo.liveUrl ?? "").trim();
  if (live && !isHttpsUrl(live)) errors["demo.liveUrl"] = "Use an https:// link to the running app.";

  if (d.tracks.selected.length > EVENT.maxTracks) errors["tracks.selected"] = `Pick at most ${EVENT.maxTracks} tracks.`;
  else if (tracks && d.tracks.selected.some((id) => !tracks.some((t) => t.id === id))) errors["tracks.selected"] = "One of your tracks isn't on this event's list.";

  if (!walletAddress) errors.wallet = "Connect your wallet to submit.";

  return { errors };
}
