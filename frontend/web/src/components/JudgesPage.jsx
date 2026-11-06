/*
 * /judge: the judges' table. Three seats; each judge fills a form describing
 * who they are, what they expect, and how much each criterion matters to
 * them. The backend compiles that into the persona the judge agent uses.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { SplitWords, bouncy, easeOut } from "./fx.jsx";
import { api, health, organizerKey } from "../lib/api.js";
import { Ring } from "./Arena.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { VoiceNote } from "./VoiceNote.jsx";

const LEVELS = ["Ignore", "Barely", "Some", "Matters", "Big", "Essential"];
const TONES = [
  { value: "strict", label: "Strict", hint: "Scores must be earned with evidence" },
  { value: "balanced", label: "Balanced", hint: "Credit what's shown, discount claims" },
  { value: "generous", label: "Generous", hint: "Rewards ambition, never fakes proof" },
];
const blankForm = (criteria) => ({
  name: "",
  title: "",
  background: "",
  expectations: "",
  browniePoints: "",
  dealBreakers: "",
  tone: "balanced",
  priorities: Object.fromEntries(criteria.map((c) => [c.id, 3])),
});

/** Same largest-remainder rule as the backend, so the preview matches what gets saved. */
function previewWeights(priorities, criteria) {
  const total = criteria.reduce((n, c) => n + (priorities[c.id] ?? 0), 0);
  if (!total) return Object.fromEntries(criteria.map((c) => [c.id, 0]));
  const raw = criteria.map((c) => ({ id: c.id, exact: ((priorities[c.id] ?? 0) * 100) / total }));
  const out = Object.fromEntries(raw.map((r) => [r.id, Math.floor(r.exact)]));
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (left-- <= 0) break;
    out[r.id] += 1;
  }
  return out;
}

export const judgeAsFighter = (j) => ({ seed: j.id ?? j.name, name: j.name, pitch: j.title, description: `${j.background} ${j.expectations}`, tracks: [] });

function WeightBars({ weights, criteria, top }) {
  const rows = criteria.map((c) => ({ ...c, w: weights[c.id] ?? 0 })).sort((a, b) => b.w - a.w).slice(0, top ?? criteria.length);
  return (
    <ul className="wbars">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="t-caption wbars__label">{r.label}</span>
          <span className="wbars__track" aria-hidden="true">
            <motion.span initial={{ width: 0 }} animate={{ width: `${r.w}%` }} transition={{ duration: 0.9, ease: easeOut, delay: 0.3 }} />
          </span>
          <span className="t-caption t-num wbars__num">{r.w}%</span>
        </li>
      ))}
    </ul>
  );
}

function Seat({ judge, criteria, onEdit, onRemove, i }) {
  return (
    <motion.article
      className="card seat"
      initial={{ opacity: 0, y: 30, rotate: i % 2 ? 1.5 : -1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      whileHover={{ y: -6 }}
      transition={{ ...bouncy, delay: i * 0.08 }}
    >
      <Ring compact className="seat__ring">
        <PixelFighter project={judgeAsFighter(judge)} scale={5} label={`${judge.name}, judge`} />
      </Ring>
      <div className="seat__body">
        <div className="fighter-card__badges">
          <StatusPill tone="neutral">{judge.tone}</StatusPill>
        </div>
        <h2 className="t-heading m0">{judge.name}</h2>
        <p className="t-caption m0">{judge.title}</p>
        <span className="t-label">Cares most about</span>
        <WeightBars weights={judge.weights} criteria={criteria} top={4} />
        <div className="seat__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={onEdit}>
            Edit judge
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function EmptySeat({ onAdd, disabled, i }) {
  return (
    <motion.article
      className="card seat seat--empty"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -6 }}
      transition={{ ...bouncy, delay: i * 0.08 }}
    >
      <Ring compact className="seat__ring">
        <PixelFighter project={{ seed: `seat-${i}`, name: "Open seat", tracks: [] }} scale={5} ghost label="Open judge seat" />
      </Ring>
      <div className="seat__body">
        <h2 className="t-heading m0">Seat open</h2>
        <p className="t-caption m0">A judge fills a short form. Their answers become the persona that scores every project.</p>
        <div>
          <button type="button" className="btn btn--oracle btn--sm" onClick={onAdd} disabled={disabled}>
            Add a judge
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="field__error">✕ {error}</span> : hint ? <span className="field__help">{hint}</span> : null}
    </div>
  );
}

const MAX_LEN = { background: 1200, expectations: 1500, browniePoints: 800, dealBreakers: 800 };

function JudgeForm({ criteria, initial, editing, voice, onCancel, onSaved }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }));
    // Editing a field clears its old error.
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };
  const weights = previewWeights(f.priorities, criteria);
  // A transcript is added after whatever the judge already wrote, never replacing it.
  // Functional update: the transcript arrives after an await, when `f` may be stale.
  const addSpoken = (k, spoken) => {
    setF((x) => ({ ...x, [k]: [x[k]?.trim(), spoken.trim()].filter(Boolean).join("\n\n").slice(0, MAX_LEN[k]) }));
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
  };

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFailure("");
    try {
      const saved = editing ? await api(`/judges/${editing.id}`, { method: "PUT", body: f }) : await api("/judges", { method: "POST", body: f });
      onSaved(saved);
    } catch (err) {
      setErrors(err.data?.errors ?? {});
      setFailure(err.data?.errors ? "Fix the marked fields." : err.message);
    } finally {
      setSaving(false);
    }
  }

  const text = (k, label, hint, area, max) => (
    <Field id={`j-${k}`} label={label} hint={hint} error={errors[k]}>
      {area ? (
        <textarea id={`j-${k}`} className="input input--area" maxLength={max} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input id={`j-${k}`} className="input" maxLength={max} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      )}
    </Field>
  );

  return (
    <motion.form
      className="card judge-form"
      onSubmit={save}
      noValidate
      aria-labelledby="jf-h"
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.45, ease: easeOut }}
    >
      <div className="judge-form__head">
        <h2 id="jf-h" className="t-display-md m0">{editing ? `Edit ${editing.name}` : "Add a judge"}</h2>
        <Ring compact className="judge-form__ring">
          <PixelFighter project={judgeAsFighter({ ...f, id: editing?.id ?? (f.name || "new") })} scale={4} label="Preview of this judge" />
        </Ring>
      </div>

      <div className="grid2">
        {text("name", "Name", null, false, 60)}
        {text("title", "What they do", "Like \"Staff engineer at a payments company\"", false, 80)}
      </div>
      {text("background", "Background", "Experience and point of view. Optional, but it makes the persona sharper.", true, 1200)}
      {text("expectations", "What do you expect from a winning project?", "The major things you look for.", true, 1500)}
      {voice && <VoiceNote model={voice.model} onText={addSpoken} />}

      <fieldset className="field priorities" aria-describedby="prio-help">
        <legend>How much does each one matter to you?</legend>
        <span id="prio-help" className="field__help">
          Every judge scores all nine. These decide how much each counts in your score. Percentages always add up to 100.
        </span>
        {errors.priorities && <span className="field__error">✕ {errors.priorities}</span>}
        <ul className="prio">
          {criteria.map((c) => (
            <li key={c.id} className="prio__row">
              <div className="prio__text">
                <span className="t-body-strong">{c.label}</span>
                <span className="t-caption">{c.about}</span>
              </div>
              <div className="prio__scale" role="radiogroup" aria-label={`${c.label} importance`}>
                {LEVELS.map((lvl, v) => (
                  <label key={v} className="prio__opt" title={lvl}>
                    <input type="radio" name={`p-${c.id}`} value={v} checked={f.priorities[c.id] === v} onChange={() => set("priorities", { ...f.priorities, [c.id]: v })} />
                    <span>{v}</span>
                  </label>
                ))}
              </div>
              <span className="t-caption t-num prio__pct">{weights[c.id]}%</span>
            </li>
          ))}
        </ul>
        <span className="t-caption">0 Ignore · 1 Barely · 2 Some · 3 Matters · 4 Big · 5 Essential</span>
      </fieldset>

      {text("browniePoints", "What earns brownie points?", "Extra credit you love to see.", true, 800)}
      {text("dealBreakers", "Deal-breakers", "Anything that sinks a project for you. Optional.", true, 800)}

      <fieldset className="field radios">
        <legend>How do you score?</legend>
        <div className="radios__row radios__row--3">
          {TONES.map((t) => (
            <label key={t.value} className="radio-card">
              <input type="radio" name="tone" value={t.value} checked={f.tone === t.value} onChange={() => set("tone", t.value)} />
              <span className="radio-card__body">
                <span className="t-body-strong">{t.label}</span>
                <span className="t-caption">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {editing?.systemPrompt && (
        <details className="prompt-preview">
          <summary className="t-label">What the judge agent is told (version {editing.version})</summary>
          <pre className="t-mono-caption">{editing.systemPrompt}</pre>
        </details>
      )}

      <div className="submit-row">
        <div className="submit-row__text" role="status" aria-live="polite">
          {failure ? <span className="field__error">✕ {failure}</span> : <span className="t-caption">Saving makes a new persona version. Past reviews keep the version they used.</span>}
        </div>
        <div className="seat__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save judge" : "Add judge"}
          </button>
        </div>
      </div>
    </motion.form>
  );
}

export function JudgesPage() {
  const [state, setState] = useState({ loading: true });
  const [editor, setEditor] = useState(null); // { editing?: judge }
  const [error, setError] = useState("");
  const [key, setKey] = useState(organizerKey.get());

  async function load() {
    const h = await health();
    if (!h) return setState({ loading: false, offline: true });
    const [criteria, judges] = await Promise.all([api("/criteria"), api("/judges")]);
    setState({ loading: false, health: h, criteria, judges });
  }
  useEffect(() => {
    load().catch((e) => setState({ loading: false, offline: true, error: e.message }));
  }, []);

  if (state.loading)
    return (
      <div className="seats" aria-busy="true">
        <span className="visually-hidden">Loading the judges…</span>
        {[0, 1, 2].map((k) => (
          <div key={k} className="card seat skeleton skeleton--seat" />
        ))}
      </div>
    );
  if (state.offline) {
    return (
      <>
        <div className="intro">
          <h1 className="t-display-lg m0">
            <SplitWords>Judges</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
            Three AI judges score every project.
          </p>
        </div>
        <motion.div className="card card--surface offline" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, ...bouncy }}>
          <div className="offline__copy">
            <h2 className="t-heading m0">The judges are offline</h2>
            <p className="t-body m0 muted">We can't reach the judging service right now. Try again in a minute.</p>
            {import.meta.env.DEV && <p className="t-mono-caption m0">Dev: cd backend && npm start</p>}
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => location.reload()}>
            Try again
          </button>
        </motion.div>
      </>
    );
  }

  const { criteria, judges, health: h } = state;
  const seats = Array.from({ length: h.maxJudges }, (_, i) => judges[i] ?? null);

  async function remove(j) {
    if (!window.confirm(`Remove ${j.name} from the panel?`)) return;
    try {
      await api(`/judges/${j.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="intro intro--row">
        <div className="intro">
          <h1 className="t-display-lg m0">
            <SplitWords>Judges</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
            Three AI judges score every project, each with their own priorities.
          </p>
        </div>
        <div className="fighter-card__badges rise" style={{ "--i": 2 }}>
          <StatusPill tone={judges.length === h.maxJudges ? "success" : "neutral"}>
            {judges.length === h.maxJudges ? "✓ " : ""}
            {judges.length}/{h.maxJudges} seats filled
          </StatusPill>
          <StatusPill tone={h.judgesReady ? "live" : "neutral"}>
            {h.judgesReady ? `Agents ready · ${h.model}${h.provider === "0g" ? " on 0G" : ""}` : `No ${h.providerLabel ?? h.provider} key on the server`}
          </StatusPill>
        </div>
      </div>
      {error && (
        <p className="field__error" role="alert">
          ✕ {error}
        </p>
      )}
      <details className="organizer" open={Boolean(key)}>
        <summary className="t-caption">Organizer key</summary>
        <div className="organizer__row">
          <input
            className="input t-mono"
            type="password"
            autoComplete="off"
            placeholder="Only needed when the server sets ADMIN_TOKEN"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              organizerKey.set(e.target.value.trim());
            }}
            aria-label="Organizer key"
          />
          <span className="t-caption">Needed to add, edit or remove judges. Kept in this tab only.</span>
        </div>
      </details>

      <AnimatePresence mode="wait">
      {editor ? (
        <JudgeForm
          key={editor.editing?.id ?? "new"}
          criteria={criteria}
          editing={editor.editing}
          voice={h.voiceNotes}
          initial={editor.editing ? { ...blankForm(criteria), ...editor.editing } : blankForm(criteria)}
          onCancel={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await load();
          }}
        />
      ) : (
        <motion.div className="seats" key="seats" exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}>
          {seats.map((j, i) =>
            j ? (
              <Seat key={j.id} judge={j} criteria={criteria} i={i} onEdit={() => setEditor({ editing: j })} onRemove={() => remove(j)} />
            ) : (
              <EmptySeat key={`empty-${i}`} i={i} onAdd={() => setEditor({})} />
            ),
          )}
        </motion.div>
      )}
      </AnimatePresence>
      {!h.judgesReady && (
        <p className="t-caption m0">
          To let the judges score projects, add <code className="t-mono-caption">{h.keyName}</code> to{" "}
          <code className="t-mono-caption">backend/.env</code> and restart the backend.
        </p>
      )}
    </>
  );
}
