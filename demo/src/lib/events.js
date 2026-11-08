/* Tournaments ("ETH Global"): their tracks and prizes, from the backend. */
import { api, peekApi } from "./api.js";

// Sponsor prize tracks, in the order a project shows them (before the event's own tracks).
const SPONSORS = { "0g": "0G", arkiv: "Arkiv", ens: "ENS", world: "World", base: "Base", self: "Self", citrea: "Citrea" };
const SPONSOR_ORDER = Object.keys(SPONSORS);
const trackNames = new Map(Object.entries(SPONSORS));
const sponsorIds = new Set(SPONSOR_ORDER);
const remember = (event) => {
  for (const t of event.tracks) {
    trackNames.set(t.id, t.name);
    if (t.sponsor) sponsorIds.add(t.id);
  }
  return event;
};

/** Sponsor tracks first (in sponsor order), then the event's own tracks as entered. */
export const sortTracks = (ids = []) => {
  const rank = (id) => (sponsorIds.has(id) ? (SPONSOR_ORDER.indexOf(id) + 1 || 50) : 100);
  return [...ids].sort((a, b) => rank(a) - rank(b));
};

// Track names from the last visit, so labels are right before /events answers again.
for (const e of peekApi("/events") ?? []) remember(e);

/** The cached copy of one tournament (its own answer, or its row in the list). */
export const cachedEvent = (id) => peekApi(`/events/${encodeURIComponent(id)}`) ?? peekApi("/events")?.find((e) => e.id === id);

export const listEvents = async () => (await api("/events")).map(remember);
export const getEvent = async (id) => remember(await api(`/events/${encodeURIComponent(id)}`));
export const createEvent = (body) => api("/events", { method: "POST", body });
export const closeEvent = (id) => api(`/events/${encodeURIComponent(id)}/close`, { method: "POST", body: {} });

/** A track's display name, once its tournament has been loaded. */
export const trackNameOf = (id) => trackNames.get(id) ?? String(id).replace(/-/g, " ");

export const eventIsOpen = (event, now = Date.now()) => now < Date.parse(event.deadline);
