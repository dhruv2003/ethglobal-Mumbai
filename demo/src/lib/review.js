/*
 * Run a project's whole review again (organizer only). Tells every live view
 * on the page to refresh so the new run shows up straight away.
 */
import { api } from "./api.js";

export const RERUN_EVENT = "arena:review-rerun";

export async function rerunReview(projectId) {
  try {
    const r = await api(`/projects/${encodeURIComponent(projectId)}/pipeline`, { method: "POST" });
    window.dispatchEvent(new CustomEvent(RERUN_EVENT, { detail: { projectId } }));
    return r;
  } catch (e) {
    throw e.status === 401 || e.status === 403 ? Object.assign(new Error("Running the review again needs the organizer key (set it on the Judges page)."), { status: e.status }) : e;
  }
}
