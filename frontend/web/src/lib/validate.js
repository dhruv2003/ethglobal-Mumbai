/*
 * Validation for the submission form. Pure: (data, context) -> { errors, warnings }.
 * Keys are field paths. Insertion order follows the page, so the first key is the
 * first problem on screen.
 */
import { EVENT, LIMITS, VIDEO_SECONDS } from "../config/event.js";

export const isAddress = (v) => /^0x[0-9a-fA-F]{40}$/.test(String(v ?? "").trim());

export const isHttpsUrl = (v) => {
  try {
    return new URL(String(v).trim()).protocol === "https:";
  } catch {
    return false;
  }
};

export const GITHUB_REPO = /^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/?$/;
export const GITHUB_USER = /^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export const SECTIONS = [
  { id: "team", title: "Team" },
  { id: "project", title: "Project" },
  { id: "tracks", title: "Tracks" },
  { id: "code", title: "Code" },
  { id: "demo", title: "Demo" },
  { id: "review", title: "Review" },
];

const blank = (v) => !String(v ?? "").trim();

export function validate(d, { walletAddress = "", today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = {};
  const warnings = {};
  const req = (path, v, msg) => {
    if (blank(v)) errors[path] = msg;
  };
  const max = (path, v, n) => {
    if (!errors[path] && String(v ?? "").length > n) errors[path] = `Keep it under ${n} characters.`;
  };

  // ---- Team
  req("team.name", d.team.name, "Give your team a name.");
  max("team.name", d.team.name, 60);
  if (!d.team.members.length) errors["team.members"] = "Add at least one team member.";
  d.team.members.forEach((m, i) => {
    const p = `team.members.${i}`;
    req(`${p}.name`, m.name, "Add this member's name.");
    max(`${p}.name`, m.name, 60);
    if (!blank(m.github) && !GITHUB_USER.test(m.github.trim()))
      errors[`${p}.github`] = "That isn't a valid GitHub username.";
    max(`${p}.role`, m.role, 40);
  });
  if (!walletAddress) errors["team.ownerWallet"] = "Connect your wallet. It becomes the team owner.";
  if (d.team.rewardDifferent && !isAddress(d.team.rewardWallet))
    errors["team.rewardWallet"] = "Enter a wallet address: 0x followed by 40 characters.";

  // ---- Project
  req("project.name", d.project.name, "Give your project a name.");
  max("project.name", d.project.name, 60);
  req("project.pitch", d.project.pitch, "Add a one-line pitch.");
  max("project.pitch", d.project.pitch, 140);
  req("project.problem", d.project.problem, "Say what problem this solves.");
  max("project.problem", d.project.problem, 1000);
  req("project.users", d.project.users, "Say who this is for.");
  max("project.users", d.project.users, 500);
  req("project.howItsMade", d.project.howItsMade, "Tell the judges how it's built.");
  max("project.howItsMade", d.project.howItsMade, 3000);
  if (d.project.tags.length > 10) errors["project.tags"] = "Use 10 tags or fewer.";
  max("project.limitations", d.project.limitations, 1500);
  if (!d.project.builtAtEvent) errors["project.builtAtEvent"] = "Tell us whether you built this at the event.";
  if (d.project.builtAtEvent === "no") {
    req("project.startDate", d.project.startDate, "When did work on this start?");
    if (!errors["project.startDate"] && d.project.startDate > today)
      errors["project.startDate"] = "That date is in the future.";
  }

  // ---- Tracks
  const known = new Set(EVENT.tracks.map((t) => t.id));
  if (d.tracks.selected.length > EVENT.maxTracks)
    errors["tracks.selected"] = `Pick at most ${EVENT.maxTracks} tracks.`;
  else if (d.tracks.selected.some((id) => !known.has(id)))
    errors["tracks.selected"] = "One of your tracks isn't on this event's list.";
  d.tracks.selected.forEach((id) => {
    const p = `tracks.justification.${id}`;
    req(p, d.tracks.justification[id], "Explain how you used this sponsor's tech.");
    max(p, d.tracks.justification[id], 1500);
  });

  // ---- Code
  const repo = d.code.repoUrl.trim();
  if (!repo) errors["code.repoUrl"] = "Add your public GitHub repository.";
  else if (!GITHUB_REPO.test(repo))
    errors["code.repoUrl"] = "Use a GitHub repo link, like https://github.com/team/project.";
  max("code.ref", d.code.ref, 100);
  const mono = d.code.monorepoPath.trim();
  if (mono && (mono.startsWith("/") || mono.split("/").includes("..")))
    errors["code.monorepoPath"] = "Use a path inside the repo, like apps/web.";
  d.code.contracts.forEach((c, i) => {
    if (!isAddress(c.address))
      errors[`code.contracts.${i}.address`] = "Enter a contract address: 0x followed by 40 characters.";
    if (!c.network) errors[`code.contracts.${i}.network`] = "Pick the network it's deployed on.";
  });

  // ---- Demo
  const videoUrl = d.demo.videoUrl.trim();
  if (!videoUrl && !d.demo.videoFile) errors["demo.video"] = "Add a demo video: a link or an MP4 file.";
  if (videoUrl && !isHttpsUrl(videoUrl)) errors["demo.videoUrl"] = "Use an https:// link.";
  const dur = d.demo.videoFile?.duration;
  if (dur && (dur < VIDEO_SECONDS.min || dur > VIDEO_SECONDS.max))
    warnings["demo.video"] = `ETHGlobal asks for 2 to 4 minutes. Yours is ${fmtDuration(dur)}.`;
  if (!blank(d.demo.liveUrl) && !isHttpsUrl(d.demo.liveUrl)) errors["demo.liveUrl"] = "Use an https:// link.";
  const total = totalFileBytes(d);
  if (total > LIMITS.total)
    errors["demo.artifacts"] = `Your files add up to ${fmtSize(total)}. The limit is ${fmtSize(LIMITS.total)}.`;

  // ---- Review
  if (!d.consent) errors["review.consent"] = "Confirm we can show your files in the public arena.";

  return { errors, warnings };
}

export function totalFileBytes(d) {
  const files = [d.project.logo, d.project.cover, d.demo.videoFile, ...d.demo.artifacts].filter(Boolean);
  return files.reduce((n, f) => n + (f.size || 0), 0);
}

export const sectionErrorKeys = (errors, id) => Object.keys(errors).filter((k) => k.startsWith(`${id}.`));

export function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function fmtDuration(s) {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}
