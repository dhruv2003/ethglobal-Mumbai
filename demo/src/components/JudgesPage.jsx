/*
 * /judge: the judge studio. Three AI personas score every project. Pick one, tune who they are and
 * what they weigh, and the right rail re-scores this event's projects with those weights, live:
 * the same criteria scores the judge already gave, recombined, so a weight change shows its effect
 * before it is saved. Saving makes a new persona version; past reviews keep the version they used.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { SplitWords, bouncy, easeOut } from "./fx.jsx";
import { api, health, peekApi } from "../lib/api.js";
import { Ring } from "./Arena.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { toast } from "./Feedback.jsx";

export const judgeAsFighter = (j) => ({ seed: j.id ?? j.name, name: j.name, pitch: j.title, description: `${j.background} ${j.expectations}`, tracks: [] });

const LEVELS = ["Ignore", "Low", "Some", "Matters", "High", "Essential"];
const TONES = [
  { value: "strict", label: "Strict", hint: "Every point needs evidence", shift: -2.5 },
  { value: "balanced", label: "Balanced", hint: "Credits what's shown, discounts claims", shift: 0 },
  { value: "generous", label: "Generous", hint: "Rewards ambition, never fakes proof", shift: 2.5 },
];
const TONE_TINT = ["crush", "oracle", "amber"];
const SHORT = { product_journey: "Journey", real_world_value: "Value", ui_ux: "UI / UX", code_quality: "Code", sdlc: "SDLC", feasibility: "Feasibility", scalability: "Scale", business_model: "Business", brownie_points: "Brownie" };

/** Same largest-remainder rule as the backend, so the preview matches what gets saved. */
export function previewWeights(priorities, criteria) {
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

/** "A. B. C." → ["A", "B", "C"]: deal-breakers and brownie points read as short chips. */
const toChips = (text) =>
  String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((s) => s.replace(/[.!?]+$/, "").trim())
    .filter(Boolean);
const fromChips = (chips) => chips.map((c) => `${c}.`).join(" ");

const draftOf = (j, criteria) => ({
  id: j?.id ?? null,
  name: j?.name ?? "",
  title: j?.title ?? "",
  background: j?.background ?? "",
  expectations: j?.expectations ?? "",
  tone: j?.tone ?? "balanced",
  priorities: { ...Object.fromEntries(criteria.map((c) => [c.id, 3])), ...(j?.priorities ?? {}) },
  dealBreakers: toChips(j?.dealBreakers),
  browniePoints: toChips(j?.browniePoints),
});
const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- the panel: one card per persona ---------- */

function PersonaTab({ judge, active, onPick, i, dirty }) {
  const w = judge.weights ?? {};
  const top = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  return (
    <motion.button
      type="button"
      layout
      className={`ptab ptab--${TONE_TINT[i % 3]} ${active ? "is-on" : ""}`}
      onClick={onPick}
      aria-pressed={active}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...bouncy, delay: i * 0.06 }}
    >
      <span className="ptab__face">
        <PixelFighter project={judgeAsFighter(judge)} scale={3} label={`${judge.name}, judge`} />
      </span>
      <span className="ptab__text">
        <b>{judge.name || "New persona"}</b>
        <small>{judge.title ? judge.title.split(/[,.]/)[0] : "Not set up yet"}</small>
      </span>
      <span className="ptab__meta">
        <span className={`ptab__tone ptab__tone--${judge.tone}`}>{judge.tone}</span>
        {top && <span className="ptab__top t-num">{SHORT[top[0]]} {top[1]}%</span>}
      </span>
      {dirty && <span className="ptab__dirty" title="Unsaved changes" />}
      {active && <motion.span layoutId="ptab-ring" className="ptab__ring" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
    </motion.button>
  );
}

/* ---------- editor parts ---------- */

function Section({ n, title, aside, children }) {
  return (
    <section className="js-sec">
      <header className="js-sec__head">
        <span className="js-sec__n t-num">{n}</span>
        <h3 className="m0">{title}</h3>
        {aside && <span className="js-sec__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** The weight mix as one bar: each criterion a segment, the top three named. */
function MixBar({ weights, criteria }) {
  const rows = criteria.map((c, i) => ({ ...c, w: weights[c.id] ?? 0, i })).filter((r) => r.w > 0);
  return (
    <div className="mix">
      <div className="mix__bar" role="img" aria-label={rows.map((r) => `${r.label} ${r.w}%`).join(", ")}>
        {rows.map((r) => (
          <motion.span key={r.id} className={`mix__seg mix__seg--${r.i}`} animate={{ flexGrow: r.w }} transition={{ type: "spring", stiffness: 260, damping: 30 }} title={`${r.label} · ${r.w}%`} />
        ))}
      </div>
    </div>
  );
}

function WeightRow({ c, i, value, pct, onChange }) {
  return (
    <li className="wrow">
      <span className={`wrow__key mix__seg--${i}`} aria-hidden="true" />
      <label className="wrow__label" htmlFor={`w-${c.id}`} title={c.about}>
        {c.label}
      </label>
      <div className="wrow__slider">
        <input
          id={`w-${c.id}`}
          type="range"
          min="0"
          max="5"
          step="1"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ "--v": `${(value / 5) * 100}%` }}
          aria-valuetext={`${LEVELS[value]}, ${pct}% of the score`}
        />
        <span className="wrow__ticks" aria-hidden="true">
          {LEVELS.map((l, k) => (
            <i key={l} className={k <= value ? "on" : ""} />
          ))}
        </span>
      </div>
      <span className="wrow__level">{LEVELS[value]}</span>
      <span className="wrow__pct t-num">{pct}%</span>
    </li>
  );
}

function Chips({ items, onChange, tone, placeholder }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().replace(/[.!?]+$/, "");
    if (t && !items.includes(t)) onChange([...items, t]);
    setText("");
  };
  return (
    <div className={`jchips jchips--${tone}`}>
      <AnimatePresence initial={false}>
        {items.map((c) => (
          <motion.span key={c} className="jchip" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: "spring", stiffness: 500, damping: 32 }}>
            <span aria-hidden="true">{tone === "bad" ? "✕" : "★"}</span> {c}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== c))} aria-label={`Remove ${c}`}>
              ×
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        className="jchips__input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && items.length) onChange(items.slice(0, -1));
        }}
        onBlur={add}
        maxLength={90}
      />
    </div>
  );
}

/** What the judge agent is told: compiled from the persona, the way the backend does it. */
function compilePrompt(d, weights, criteria) {
  const top = criteria
    .map((c) => [c.label, weights[c.id]])
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([l, w]) => `${l} ${w}%`)
    .join(", ");
  const tone = TONES.find((t) => t.value === d.tone);
  return [
    `You are ${d.name || "a judge"}, ${d.title || "a hackathon judge"}.`,
    d.background && `Background: ${d.background}`,
    `Score every criterion 0-100 from the evidence pack only. Weights: ${top}.`,
    `Tone: ${tone?.label.toLowerCase()}. ${tone?.hint}.`,
    d.dealBreakers.length && `Deal-breakers (cap the score at 40 and say why): ${d.dealBreakers.join("; ")}.`,
    d.browniePoints.length && `Brownie points: ${d.browniePoints.join("; ")}.`,
    "Cite an evidence id (E1, V-laptop-d2) for every claim. If it isn't in the evidence, it didn't happen.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ---------- live preview: this event's projects, re-scored ---------- */

function useEventScores(judgeId, criteria) {
  const [rows, setRows] = useState(() => peekApi("/submissions")?.map((s) => ({ id: s.id, name: s.project.name })) ?? []);
  const [cards, setCards] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const subs = await api("/submissions").catch(() => []);
      const results = await Promise.all(subs.map((s) => api(`/projects/${encodeURIComponent(s.id)}/reviews`).then((r) => [s.id, r?.result]).catch(() => [s.id, null])));
      if (!alive) return;
      setRows(subs.map((s) => ({ id: s.id, name: s.project.name, seed: s.fighterSeed })));
      setCards(Object.fromEntries(results));
    })();
    return () => {
      alive = false;
    };
  }, []);
  // Per project: this judge's criterion scores, or the panel's average for a persona that hasn't judged yet.
  return useMemo(
    () =>
      rows
        .map((r) => {
          const res = cards[r.id];
          if (!res) return null;
          const mine = res.reviews.find((x) => x.judgeId === judgeId);
          const crit = Object.fromEntries(
            criteria.map((c) => {
              const scores = (mine ? [mine] : res.reviews).map((x) => x.review.criteria.find((y) => y.id === c.id)?.score ?? 0);
              return [c.id, scores.reduce((a, b) => a + b, 0) / scores.length];
            }),
          );
          return { ...r, crit, saved: mine ? mine.overallHundredths / 100 : null };
        })
        .filter(Boolean),
    [rows, cards, judgeId, criteria],
  );
}

const scoreWith = (crit, weights, shift) => Math.max(0, Math.min(100, Object.entries(weights).reduce((s, [id, w]) => s + (w * (crit[id] ?? 0)) / 100, 0) + shift));

function Preview({ draft, weights, savedWeights, savedTone, criteria, first }) {
  const projects = useEventScores(draft.id, criteria);
  const shift = TONES.find((t) => t.value === draft.tone)?.shift ?? 0;
  const savedShift = TONES.find((t) => t.value === savedTone)?.shift ?? 0;
  const ranked = projects
    .map((p) => ({ ...p, now: scoreWith(p.crit, weights, shift), was: scoreWith(p.crit, savedWeights, savedShift) }))
    .sort((a, b) => b.now - a.now);
  const before = [...ranked].sort((a, b) => b.was - a.was).map((p) => p.id);
  const moved = ranked.filter((p, i) => before.indexOf(p.id) !== i).length;
  return (
    <aside className="jprev" aria-labelledby="jprev-h">
      <header className="jprev__head">
        <span className="ov-kicker">Live preview</span>
        <h3 id="jprev-h" className="m0">
          How {first || "this persona"} ranks the event
        </h3>
        <p className="m0">
          {moved ? (
            <>
              <b className="t-num">{moved}</b> {moved === 1 ? "project moves" : "projects move"} with these changes
            </>
          ) : (
            "Change a weight or the tone to see the ranking move."
          )}
        </p>
      </header>
      <LayoutGroup>
        <ol className="jrank m0">
          {ranked.map((p, i) => {
            const d = p.now - p.was;
            const up = before.indexOf(p.id) - i;
            return (
              <motion.li key={p.id} layout transition={{ type: "spring", stiffness: 420, damping: 36 }} className={`jrank__row ${up > 0 ? "is-up" : up < 0 ? "is-down" : ""}`}>
                <span className="jrank__n t-num">{i + 1}</span>
                <span className="jrank__name">{p.name}</span>
                <span className="jrank__bar" aria-hidden="true">
                  <motion.span animate={{ width: `${p.now}%` }} transition={{ type: "spring", stiffness: 200, damping: 28 }} className={p.now >= 70 ? "hi" : p.now >= 50 ? "mid" : "lo"} />
                </span>
                <span className="jrank__score t-num">{p.now.toFixed(1)}</span>
                <span className={`jrank__d t-num ${Math.abs(d) < 0.05 ? "is-zero" : d > 0 ? "is-pos" : "is-neg"}`}>{Math.abs(d) < 0.05 ? "–" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}</span>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
      <p className="jprev__foot m0">Same criterion scores, recombined with your weights. The agent re-reads the evidence on the next review.</p>
    </aside>
  );
}

/* ---------- the studio ---------- */

function Studio({ judge, criteria, i, onSaved, onRemove, onDirty }) {
  const base = useMemo(() => draftOf(judge, criteria), [judge, criteria]);
  const [d, setD] = useState(base);
  const [saving, setSaving] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => setD(base), [base]);
  const dirty = !sameDraft(d, base);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const weights = previewWeights(d.priorities, criteria);
  const savedWeights = judge?.weights ?? weights;
  const changes = criteria.filter((c) => d.priorities[c.id] !== base.priorities[c.id]).length + (d.tone !== base.tone) + ["name", "title", "background"].filter((k) => d[k] !== base[k]).length + (sameDraft(d.dealBreakers, base.dealBreakers) ? 0 : 1) + (sameDraft(d.browniePoints, base.browniePoints) ? 0 : 1);
  const top3 = criteria.map((c) => [c, weights[c.id]]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const version = judge?.version ?? 0;

  async function save() {
    setSaving(true);
    try {
      const body = { ...d, dealBreakers: fromChips(d.dealBreakers), browniePoints: fromChips(d.browniePoints), weights };
      const saved = d.id ? await api(`/judges/${d.id}`, { method: "PUT", body }) : await api("/judges", { method: "POST", body });
      toast(`${saved.name} saved as v${saved.version ?? version + 1}.`);
      onSaved(saved);
    } catch (e) {
      toast(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="studio">
      <motion.div className="jcard" key={judge?.id ?? "new"} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
        <header className={`jid jid--${TONE_TINT[i % 3]}`}>
          <Ring compact className="jid__ring">
            <PixelFighter project={judgeAsFighter({ ...d, id: d.id ?? (d.name || "new") })} scale={5} label={`${d.name || "New persona"}, preview`} />
          </Ring>
          <div className="jid__fields">
            <input className="jid__name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Judge name" maxLength={60} aria-label="Name" />
            <input className="jid__title" value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="What they do, in one line" maxLength={80} aria-label="What they do" />
            <div className="jid__chips">
              <span className="jver t-num">{version ? `v${version}` : "draft"}</span>
              <span className="jver jver--model">0gm-1.0-35b · 0G</span>
              {top3.map(([c, w]) => (
                <span key={c.id} className="jtop">
                  {SHORT[c.id]} <b className="t-num">{w}%</b>
                </span>
              ))}
            </div>
          </div>
        </header>

        <Section n="1" title="Who they are">
          <textarea className="input input--area jbio" value={d.background} onChange={(e) => set("background", e.target.value)} placeholder="Experience and point of view in two sentences. It shapes how the agent reads a demo." maxLength={400} rows={3} />
        </Section>

        <Section n="2" title="What they weigh" aside={<span className="t-num">{Object.values(weights).reduce((a, b) => a + b, 0)}% total</span>}>
          <MixBar weights={weights} criteria={criteria} />
          <ul className="wrows m0">
            {criteria.map((c, k) => (
              <WeightRow key={c.id} c={c} i={k} value={d.priorities[c.id] ?? 0} pct={weights[c.id]} onChange={(v) => set("priorities", { ...d.priorities, [c.id]: v })} />
            ))}
          </ul>
        </Section>

        <Section n="3" title="How they score">
          <div className="tones" role="radiogroup" aria-label="Tone">
            {TONES.map((t) => (
              <label key={t.value} className={`tone ${d.tone === t.value ? "is-on" : ""}`}>
                <input type="radio" name="tone" value={t.value} checked={d.tone === t.value} onChange={() => set("tone", t.value)} />
                <b>{t.label}</b>
                <small>{t.hint}</small>
                {d.tone === t.value && <motion.span layoutId="tone-on" className="tone__on" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              </label>
            ))}
          </div>
        </Section>

        <Section n="4" title="Lines they draw">
          <div className="jlines">
            <div>
              <span className="jlines__h">Deal-breakers</span>
              <Chips items={d.dealBreakers} onChange={(v) => set("dealBreakers", v)} tone="bad" placeholder="Add one, press Enter" />
            </div>
            <div>
              <span className="jlines__h">Brownie points</span>
              <Chips items={d.browniePoints} onChange={(v) => set("browniePoints", v)} tone="good" placeholder="Add one, press Enter" />
            </div>
          </div>
        </Section>

        <button type="button" className="jprompt__toggle" onClick={() => setShowPrompt((s) => !s)} aria-expanded={showPrompt}>
          <span>{showPrompt ? "Hide" : "Show"} what the agent is told</span>
          <span aria-hidden="true">{showPrompt ? "−" : "+"}</span>
        </button>
        <AnimatePresence initial={false}>
          {showPrompt && (
            <motion.pre className="jprompt" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: easeOut }}>
              {compilePrompt(d, weights, criteria)}
            </motion.pre>
          )}
        </AnimatePresence>

        <footer className={`jbar ${dirty ? "is-dirty" : ""}`}>
          <span className="jbar__state">
            {dirty ? (
              <>
                <span className="jbar__dot" /> {changes} unsaved {changes === 1 ? "change" : "changes"}
              </>
            ) : version ? (
              <>Saved · past reviews keep the version they used</>
            ) : (
              <>New persona</>
            )}
          </span>
          {judge && (
            <button type="button" className="jbar__link" onClick={onRemove}>
              Remove
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setD(base)} disabled={!dirty}>
            Reset
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving || !dirty || !d.name.trim()}>
            {saving ? "Saving…" : version ? `Save as v${version + 1}` : "Create persona"}
          </button>
        </footer>
      </motion.div>

      <Preview draft={d} weights={weights} savedWeights={savedWeights} savedTone={base.tone} criteria={criteria} first={d.name.split(" ")[0]} />
    </div>
  );
}

export function JudgesPage() {
  const [state, setState] = useState(() => {
    const criteria = peekApi("/criteria");
    const judges = peekApi("/judges");
    return criteria && judges ? { criteria, judges } : { loading: true };
  });
  const [pick, setPick] = useState(null); // judge id, or "new"
  const [dirty, setDirty] = useState(false);

  async function load(select) {
    const h = await health();
    if (!h) return setState((s) => (s.judges ? s : { offline: true }));
    const [criteria, judges] = await Promise.all([api("/criteria"), api("/judges")]);
    setState({ criteria, judges, model: h.model });
    if (select) setPick(select);
  }
  useEffect(() => {
    load().catch((e) => setState((s) => (s.judges ? s : { error: e.message })));
  }, []);

  if (state.loading)
    return (
      <div className="jstudio" aria-busy="true">
        <div className="ptabs">
          {[0, 1, 2].map((k) => (
            <div key={k} className="ptab skeleton" style={{ height: 76 }} />
          ))}
        </div>
        <div className="card skeleton" style={{ height: 520 }} />
      </div>
    );
  if (state.offline || state.error)
    return (
      <div className="card card--surface stack">
        <h2 className="t-heading m0">The judges are offline</h2>
        <p className="t-body m0 muted">{state.error ?? "We can't reach the judging service right now. Try again in a minute."}</p>
      </div>
    );

  const { criteria, judges } = state;
  const current = pick === "new" ? null : judges.find((j) => j.id === pick) ?? judges[0];
  const idx = current ? judges.indexOf(current) : judges.length;
  const choose = (id) => {
    if (dirty && !window.confirm("Discard unsaved changes to this persona?")) return;
    setDirty(false);
    setPick(id);
  };

  async function remove(j) {
    if (!window.confirm(`Remove ${j.name} from the panel? Past scores stay on record.`)) return;
    await api(`/judges/${j.id}`, { method: "DELETE" }).catch(() => null);
    setDirty(false);
    setState((s) => ({ ...s, judges: s.judges.filter((x) => x.id !== j.id) }));
    setPick(null);
    toast(`${j.name} removed from the panel.`);
  }

  return (
    <div className="jstudio">
      <header className="jhead">
        <div className="jhead__text">
          <span className="eyebrow rise">The panel</span>
          <h1 className="t-display-lg m0">
            <SplitWords>Judges</SplitWords>
          </h1>
          <p className="t-body m0 muted rise" style={{ "--i": 1 }}>
            AI personas that score every project. Tune what each one values; the ranking updates as you go.
          </p>
        </div>
        <div className="jhead__stats rise" style={{ "--i": 2 }}>
          <span>
            <b className="t-num">{judges.length}</b> personas
          </span>
          <span>
            <b className="t-num">9</b> criteria
          </span>
          <span className="jhead__live">
            <i aria-hidden="true" /> {state.model ?? "0gm-1.0-35b-a3b"} on 0G
          </span>
        </div>
      </header>

      <LayoutGroup>
        <nav className="ptabs" aria-label="Personas">
          {judges.map((j, i) => (
            <PersonaTab key={j.id} judge={j} i={i} active={current?.id === j.id} onPick={() => choose(j.id)} dirty={dirty && current?.id === j.id} />
          ))}
          <motion.button type="button" className={`ptab ptab--new ${pick === "new" ? "is-on" : ""}`} onClick={() => choose("new")} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ ...bouncy, delay: judges.length * 0.06 }}>
            <span className="ptab__plus" aria-hidden="true">
              +
            </span>
            <span className="ptab__text">
              <b>New persona</b>
              <small>Start from the panel average</small>
            </span>
            {pick === "new" && <motion.span layoutId="ptab-ring" className="ptab__ring" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          </motion.button>
        </nav>
      </LayoutGroup>

      <AnimatePresence mode="wait">
        <motion.div key={current?.id ?? "new"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
          <Studio judge={current} criteria={criteria} i={idx} onDirty={setDirty} onRemove={() => current && remove(current)} onSaved={(saved) => load(saved.id)} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
