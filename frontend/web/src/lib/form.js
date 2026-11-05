/* Form data shape and immutable path helpers. Paths look like "team.members.0.name". */

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 8);

export const emptyMember = () => ({ id: newId(), name: "", github: "", role: "" });
export const emptyContract = () => ({ id: newId(), address: "", network: "" });

export function emptyForm() {
  return {
    team: {
      name: "",
      members: [emptyMember()],
      rewardDifferent: false,
      rewardWallet: "",
    },
    project: {
      name: "",
      pitch: "",
      problem: "",
      users: "",
      howItsMade: "",
      tags: [],
      limitations: "",
      builtAtEvent: "",
      startDate: "",
      logo: null,
      cover: null,
    },
    tracks: { selected: [], justification: {} },
    code: { repoUrl: "", ref: "", monorepoPath: "", contracts: [] },
    demo: { videoUrl: "", videoFile: null, liveUrl: "", artifacts: [] },
    consent: false,
  };
}

export function getIn(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setIn(obj, path, value) {
  const [head, ...rest] = path.split(".");
  const next = Array.isArray(obj) ? [...obj] : { ...obj };
  next[head] = rest.length ? setIn(obj?.[head] ?? {}, rest.join("."), value) : value;
  return next;
}

/** Deep-merge a saved draft onto an empty form so new fields get defaults. */
export function mergeDraft(draft) {
  const base = emptyForm();
  if (!draft || typeof draft !== "object") return base;
  const merge = (b, d) => {
    if (Array.isArray(b)) return Array.isArray(d) ? d : b;
    if (b && typeof b === "object") {
      const out = { ...b };
      for (const k of Object.keys(b)) out[k] = d && k in d ? merge(b[k], d[k]) : b[k];
      // keep dynamic keys (track justifications)
      if (d && typeof d === "object") for (const k of Object.keys(d)) if (!(k in b)) out[k] = d[k];
      return out;
    }
    return d === undefined ? b : d;
  };
  return merge(base, draft);
}
