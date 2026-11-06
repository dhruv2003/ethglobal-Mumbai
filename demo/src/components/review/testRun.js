/* Shared by the Testing tab's parts: what each step status looks like, and how runs are read. */

/** Step statuses. Each carries a mark and a word, never colour alone. */
export const ST = {
  passed: { mark: "✓", tone: "good", word: "Works" },
  failed: { mark: "✕", tone: "bad", word: "Broken" },
  missing: { mark: "?", tone: "warn", word: "Not on the live site" },
  blocked: { mark: "–", tone: "skip", word: "Can't run in a browser" },
};

/** Seconds as m:ss. */
export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Every step of a run, across its phases. */
export const allSteps = (run) => (run.phases ?? []).flatMap((p) => p.steps.map((s) => ({ ...s, phase: p.id })));
