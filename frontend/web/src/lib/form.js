/* Form data shape and immutable path helpers. Paths look like "project.name". */

export function emptyForm() {
  return {
    team: { name: "" },
    project: { name: "", pitch: "", description: "" },
    code: { repoUrl: "" },
    demo: { videoUrl: "" },
    tracks: { selected: [] },
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

/** Overlay a saved draft on an empty form, keeping only fields the form still has. */
export function mergeDraft(draft) {
  const merge = (base, d) => {
    if (Array.isArray(base)) return Array.isArray(d) ? d : base;
    if (base && typeof base === "object") {
      const out = {};
      for (const k of Object.keys(base)) out[k] = merge(base[k], d?.[k]);
      return out;
    }
    return typeof d === typeof base ? d : base;
  };
  return merge(emptyForm(), draft && typeof draft === "object" ? draft : {});
}
