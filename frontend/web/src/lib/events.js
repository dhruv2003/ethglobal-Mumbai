/* Tournaments ("ETH Global"): their tracks and prizes, from the backend. */
import { api } from "./api.js";

const trackNames = new Map();
const remember = (event) => {
  for (const t of event.tracks) trackNames.set(t.id, t.name);
  return event;
};

export const listEvents = async () => (await api("/events")).map(remember);
export const getEvent = async (id) => remember(await api(`/events/${encodeURIComponent(id)}`));
export const createEvent = (body) => api("/events", { method: "POST", body });
export const closeEvent = (id) => api(`/events/${encodeURIComponent(id)}/close`, { method: "POST", body: {} });

/** A track's display name, once its tournament has been loaded. */
export const trackNameOf = (id) => trackNames.get(id) ?? String(id).replace(/-/g, " ");

export const eventIsOpen = (event, now = Date.now()) => now < Date.parse(event.deadline);
