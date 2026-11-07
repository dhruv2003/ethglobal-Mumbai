import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { bouncy, easeOut } from "./fx.jsx";
import { EVENT } from "../config/event.js";
import { LIMITS } from "../lib/validate.js";
import { shortAddress } from "../lib/wallet.js";
import { Msg, TextField, fieldId, useForm } from "./fields.jsx";
import { DemoVideoField } from "./DemoVideoField.jsx";

/*
 * /tournaments/:id/submit — one step at a time: Pitch → Proof → Arena → Enter.
 * The stepper always shows what's left; the last step is a review you sign.
 */

const STEPS = [
  { id: "pitch", tone: "crush", title: "The pitch", short: "Pitch", sub: "Who you are and what you built.", fields: ["team.name", "project.name", "project.pitch", "project.description"] },
  { id: "proof", tone: "oracle", title: "The proof", short: "Proof", sub: "Judges read the code and watch the demo.", fields: ["code.repoUrl", "demo.videoUrl", "demo.liveUrl"] },
  { id: "arena", tone: "sunny", title: "The arena", short: "Arena", sub: "Every project fights for finalist. Tracks add extra brackets.", fields: ["tracks.selected"] },
  { id: "enter", tone: "ink", title: "Enter the arena", short: "Enter", sub: "Check everything, then sign with your wallet.", fields: [] },
];

const LABELS = {
  "team.name": "Team name",
  "project.name": "Project name",
  "project.pitch": "Pitch",
  "project.description": "Description",
  "code.repoUrl": "GitHub repository",
  "demo.videoUrl": "Demo",
  "demo.liveUrl": "Live app",
  "tracks.selected": "Sponsor tracks",
};

const TRACK_TONES = ["crush", "oracle", "sunny", "mint"];
const stepOf = (path) => STEPS.findIndex((s) => s.fields.includes(path));

/** The whole entry: stepper, the current step, and a sticky nav bar. */
export function SubmissionForm({ tracks, wallet, onSubmit, submitState, problemCount }) {
  const { data, errors, touch } = useForm();
  const problems = Object.keys(errors).filter((k) => k !== "wallet");
  const missing = (i) => STEPS[i].fields.filter((p) => errors[p]).length;
  const pristine = !data.team.name && !data.project.name && !data.code.repoUrl;

  // Come back to a draft where you left off: the first step with something missing.
  const [step, setStep] = useState(() => {
    if (pristine) return 0;
    const first = STEPS.findIndex((s, i) => i < 3 && s.fields.some((p) => errors[p]));
    return first === -1 ? 3 : first;
  });
  // A step only shows ✓ once you've been there, so optional steps don't look done before you've seen them.
  const [visited, setVisited] = useState(() => new Set(Array.from({ length: step + 1 }, (_, i) => i)));
  const [dir, setDir] = useState(1);
  const [nudge, setNudge] = useState(0);
  const top = useRef(null);
  const pendingFocus = useRef(null);

  const go = (i, focusPath) => {
    if (i === step) {
      if (focusPath) focusField(focusPath);
      return;
    }
    setDir(i > step ? 1 : -1);
    setStep(i);
    setVisited((v) => (v.has(i) ? v : new Set([...v, i])));
    pendingFocus.current = focusPath ?? null;
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 72) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!pendingFocus.current) return undefined;
    const path = pendingFocus.current;
    pendingFocus.current = null;
    const t = setTimeout(() => focusField(path), 320);
    return () => clearTimeout(t);
  }, [step]);

  const next = () => {
    const fields = STEPS[step].fields;
    fields.forEach(touch);
    const bad = fields.find((p) => errors[p]);
    if (bad) {
      setNudge((n) => n + 1);
      focusField(bad);
      return;
    }
    go(Math.min(step + 1, STEPS.length - 1));
  };

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <form
      className="form wiz"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // Enter in a field moves on; only the last step actually submits.
        if (!last) return next();
        if (problems.length) {
          STEPS.flatMap((x) => x.fields).forEach(touch);
          setNudge((n) => n + 1);
        }
        onSubmit();
      }}
    >
      <div ref={top} className="wiz__anchor" />
      <Stepper step={step} visited={visited} missing={missing} problems={problems} onPick={go} />

      <div className="wiz__stage">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.section
            key={s.id}
            custom={dir}
            className={`card wstep wstep--${s.tone}`}
            aria-labelledby={`wstep-${s.id}`}
            initial={{ opacity: 0, x: dir * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -36, transition: { duration: 0.14 } }}
            transition={{ duration: 0.32, ease: easeOut }}
          >
            <header className="wstep__head">
              <span className="wstep__num" aria-hidden="true">
                {step + 1}
              </span>
              <div className="wstep__title">
                <span className="t-label">
                  Step {step + 1} of {STEPS.length}
                </span>
                <h2 id={`wstep-${s.id}`} className="t-heading m0">
                  {s.title}
                </h2>
                <p className="t-caption m0">{s.sub}</p>
              </div>
            </header>
            <div className="wstep__body">
              {s.id === "pitch" && <PitchStep />}
              {s.id === "proof" && <ProofStep />}
              {s.id === "arena" && <ArenaStep tracks={tracks} />}
              {s.id === "enter" && <ReviewStep tracks={tracks} problems={problems} onEdit={go} wallet={wallet} nudge={nudge} />}
            </div>
          </motion.section>
        </AnimatePresence>
      </div>

      <NavBar
        step={step}
        missing={missing(step)}
        nudge={nudge}
        onBack={() => go(step - 1)}
        onNext={next}
        wallet={wallet}
        submitState={submitState}
        problemCount={problemCount}
      />
    </form>
  );
}

function focusField(path) {
  const el = document.getElementById(fieldId(path)) ?? document.querySelector(`[aria-describedby="${fieldId(path)}-msg"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ---------- Stepper ---------- */

function Stepper({ step, visited, missing, problems, onPick }) {
  return (
    <LayoutGroup id="wiz-steps">
      <nav className="wsteps" aria-label="Entry steps">
        <ol>
          {STEPS.map((x, i) => {
            const on = i === step;
            const left = i < 3 ? missing(i) : problems.length;
            const done = i < 3 && left === 0 && (visited.has(i) || i < step);
            return (
              <li key={x.id} className="wsteps__item">
                {i > 0 && <span className={`wsteps__link ${i <= step ? "wsteps__link--on" : ""}`} aria-hidden="true" />}
                <button
                  type="button"
                  className={`wsteps__btn wsteps__btn--${x.tone} ${on ? "wsteps__btn--on" : ""} ${done ? "wsteps__btn--done" : ""}`}
                  aria-current={on ? "step" : undefined}
                  onClick={() => onPick(i)}
                >
                  {on && <motion.span layoutId="wsteps-thumb" className="wsteps__thumb" transition={bouncy} />}
                  <span className="wsteps__dot" aria-hidden="true">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span key={done ? "d" : "n"} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={bouncy}>
                        {done ? "✓" : i + 1}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  <span className="wsteps__label">{x.short}</span>
                  {!done && i < 3 && left > 0 && !on && (
                    <span className="wsteps__badge" aria-label={`${left} left`}>
                      {left}
                    </span>
                  )}
                  {done && <span className="visually-hidden"> (complete)</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </LayoutGroup>
  );
}

/* ---------- Steps ---------- */

function PitchStep() {
  const { data } = useForm();
  return (
    <>
      <div className="grid2">
        <TextField path="team.name" label="Team name" limit={LIMITS.teamName} autoComplete="organization" placeholder="e.g. Chai & Chain" />
        <TextField path="project.name" label="Project name" limit={LIMITS.projectName} placeholder="What's it called?" />
      </div>
      <TextField path="project.pitch" label="Pitch" limit={LIMITS.pitch} placeholder="One line that sells it" help="Shown on your fighter card and in the arena." />
      <TextField
        path="project.description"
        label="Description"
        multiline
        limit={LIMITS.description}
        placeholder="The problem, who it's for, and how it's built. Judges check this against your code."
      />
      <DescriptionHints text={data.project.description} />
    </>
  );
}

/** Three nudges judges actually look for; each lights up when the description covers it. */
function DescriptionHints({ text }) {
  const t = text.toLowerCase();
  const hints = [
    { id: "problem", label: "The problem", hit: /problem|pain|today|hard|issue|struggle/.test(t) },
    { id: "who", label: "Who it's for", hit: /for |users?|teams?|people|developers?|builders?/.test(t) },
    { id: "how", label: "How it's built", hit: /built|uses?|using|stack|contract|react|node|solidity|api|model/.test(t) },
    { id: "length", label: "80+ words", hit: t.trim().split(/\s+/).filter(Boolean).length >= 80 },
  ];
  return (
    <ul className="dhints" aria-label="What a strong description covers">
      {hints.map((h) => (
        <li key={h.id} className={`dhint ${h.hit ? "dhint--on" : ""}`}>
          <span className="dhint__mark" aria-hidden="true">
            {h.hit ? "✓" : ""}
          </span>
          {h.label}
          <span className="visually-hidden">{h.hit ? " (covered)" : " (not yet)"}</span>
        </li>
      ))}
    </ul>
  );
}

function ProofStep() {
  return (
    <>
      <TextField
        path="code.repoUrl"
        label="GitHub repository"
        type="url"
        inputMode="url"
        mono
        placeholder="https://github.com/team/project"
        help="Must be public. We pin the commit at the deadline."
        autoCapitalize="off"
        spellCheck={false}
      />
      <DemoVideoField />
      <TextField
        path="demo.liveUrl"
        label="Live app (optional)"
        type="url"
        inputMode="url"
        placeholder="https://your-app.xyz"
        help="We open it in a cloud browser at laptop and phone size. Leave empty to use the repo's homepage."
        autoCapitalize="off"
        spellCheck={false}
      />
    </>
  );
}

function ArenaStep({ tracks }) {
  const { data, set, errors, showAll } = useForm();
  const selected = data.tracks.selected;
  const full = selected.length >= EVENT.maxTracks;
  const toggle = (id) => {
    if (selected.includes(id)) set("tracks.selected", selected.filter((x) => x !== id));
    else if (!full) set("tracks.selected", [...selected, id]);
  };
  return (
    <fieldset className="field tracks" aria-describedby="f-tracks-selected-msg">
      <legend className="tracks__legend">
        <span>Brackets you'll fight in</span>
        <span className="wpicks t-num" aria-live="polite">
          {Array.from({ length: EVENT.maxTracks }, (_, i) => (
            <span key={i} className={`wpicks__pip ${i < selected.length ? "wpicks__pip--on" : ""}`} aria-hidden="true" />
          ))}
          {selected.length} of {EVENT.maxTracks} tracks
        </span>
      </legend>
      <div className="trackcards" id={fieldId("tracks.selected")} tabIndex={-1}>
        <div className="trackcard trackcard--locked" aria-label="Overall finalist, always entered">
          <span className="trackcard__mark" aria-hidden="true">★</span>
          <span className="trackcard__text">
            <span className="trackcard__name">Overall finalist</span>
            <span className="trackcard__prize">Every project, automatically</span>
          </span>
        </div>
        {tracks.map((t, i) => {
          const on = selected.includes(t.id);
          const blocked = !on && full;
          return (
            <motion.button
              key={t.id}
              type="button"
              className={`trackcard trackcard--${TRACK_TONES[i % TRACK_TONES.length]} ${on ? "trackcard--on" : ""}`}
              aria-pressed={on}
              aria-disabled={blocked}
              onClick={() => toggle(t.id)}
              whileTap={blocked ? { x: [0, -4, 4, -2, 0] } : { scale: 0.97 }}
              transition={bouncy}
            >
              <span className="trackcard__mark" aria-hidden="true">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={on ? "on" : "off"} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={bouncy}>
                    {on ? "✓" : "+"}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="trackcard__text">
                <span className="trackcard__name">{t.name}</span>
                <span className="trackcard__prize">{t.prize ? `Prize · ${t.prize}` : "Sponsor track"}</span>
              </span>
              <span className="trackcard__state">{on ? "Entered" : blocked ? "Max 3" : "Enter"}</span>
            </motion.button>
          );
        })}
      </div>
      <Msg
        id="f-tracks-selected-msg"
        help={full ? `That's ${EVENT.maxTracks}. Remove one to pick another.` : "Optional. Your first track colours your fighter's jacket."}
        error={showAll ? errors["tracks.selected"] : undefined}
      />
    </fieldset>
  );
}

function ReviewStep({ tracks, problems, onEdit, wallet, nudge }) {
  const { data } = useForm();
  const d = data;
  const demo =
    d.demo.source === "upload" ? (d.demo.upload?.name ? `Uploaded · ${d.demo.upload.name}` : "") : d.demo.source === "images" ? (d.demo.images?.length ? `${d.demo.images.length} screenshot${d.demo.images.length === 1 ? "" : "s"}` : "") : d.demo.videoUrl;
  const picked = tracks.filter((t) => d.tracks.selected.includes(t.id));
  const desc = d.project.description.trim();

  const sections = [
    {
      step: 0,
      rows: [
        ["Team", d.team.name, "team.name"],
        ["Project", d.project.name, "project.name"],
        ["Pitch", d.project.pitch, "project.pitch"],
        ["Description", desc ? `${desc.slice(0, 180)}${desc.length > 180 ? "…" : ""}` : "", "project.description"],
      ],
    },
    {
      step: 1,
      rows: [
        ["Repository", d.code.repoUrl, "code.repoUrl", true],
        ["Demo", demo, "demo.videoUrl", d.demo.source === "link"],
        ["Live app", d.demo.liveUrl || "Repo homepage", "demo.liveUrl", Boolean(d.demo.liveUrl)],
      ],
    },
  ];

  return (
    <div className="wreview">
      <AnimatePresence initial={false}>
        {problems.length > 0 && (
          <motion.div
            key={`p-${nudge}`}
            className="wfix"
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, x: nudge ? [0, -6, 6, -3, 0] : 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35 }}
          >
            <strong className="t-body-strong">
              {problems.length} {problems.length === 1 ? "thing" : "things"} to fix before you can enter
            </strong>
            <ul>
              {problems.map((p) => (
                <li key={p}>
                  <button type="button" className="wfix__link" onClick={() => onEdit(stepOf(p), p)}>
                    <span>{LABELS[p] ?? p}</span>
                    <span aria-hidden="true">Fix →</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {sections.map((sec) => {
        const st = STEPS[sec.step];
        const bad = st.fields.filter((p) => problems.includes(p)).length;
        return (
          <section key={st.id} className={`wsum wsum--${st.tone}`} aria-label={st.title}>
            <header className="wsum__head">
              <span className="wsum__title">
                <span className={`wsum__state ${bad ? "wsum__state--bad" : ""}`} aria-hidden="true">
                  {bad ? "!" : "✓"}
                </span>
                {st.title}
              </span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(sec.step)}>
                Edit
              </button>
            </header>
            <dl className="wsum__rows">
              {sec.rows.map(([k, v, path, mono]) => {
                const err = problems.includes(path);
                return (
                  <div key={k} className={`wsum__row ${err ? "wsum__row--bad" : ""}`}>
                    <dt>{k}</dt>
                    <dd className={mono && v ? "t-mono" : ""}>{v || <span className="wsum__empty">{err ? "Missing" : "—"}</span>}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}

      <section className="wsum wsum--sunny" aria-label="Brackets">
        <header className="wsum__head">
          <span className="wsum__title">
            <span className="wsum__state" aria-hidden="true">✓</span>
            Brackets
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit(2)}>
            Edit
          </button>
        </header>
        <div className="wsum__chips">
          <span className="wsum__chip wsum__chip--ink">★ Overall finalist</span>
          {picked.map((t) => (
            <span key={t.id} className="wsum__chip">
              {t.name}
            </span>
          ))}
          {!picked.length && <span className="t-caption">No sponsor tracks. That's fine.</span>}
        </div>
      </section>

      <WalletCard wallet={wallet} />
    </div>
  );
}

function WalletCard({ wallet }) {
  const connected = wallet.status === "connected";
  return (
    <section className={`wwallet ${connected ? "wwallet--on" : ""}`} aria-label="Wallet">
      <span className="wwallet__icon" aria-hidden="true">
        {connected ? "✓" : "◆"}
      </span>
      <div className="wwallet__text">
        <span className="t-body-strong">{connected ? `Signing as ${shortAddress(wallet.address)}` : "Your wallet owns this entry"}</span>
        <span className="t-caption">
          {connected
            ? "Prizes go to this address. Signing is free: no gas, no transaction."
            : wallet.status === "unavailable"
              ? "Install MetaMask to sign your entry. It receives any prizes."
              : "Connect it to sign. Free: no gas, no transaction. It receives any prizes."}
        </span>
      </div>
      {!connected && wallet.status !== "unavailable" && (
        <button type="button" className="btn btn--oracle btn--sm" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
          {wallet.status === "connecting" ? "Check MetaMask…" : "Connect wallet"}
        </button>
      )}
    </section>
  );
}

/* ---------- Sticky nav ---------- */

function NavBar({ step, missing, nudge, onBack, onNext, wallet, submitState, problemCount }) {
  const last = step === STEPS.length - 1;
  const connected = wallet.status === "connected";
  const busy = submitState.phase === "signing" || submitState.phase === "saving";
  const nextStep = STEPS[step + 1];

  let status;
  if (submitState.error) status = <span className="field__error">✕ {submitState.error}</span>;
  else if (last && problemCount) status = <span className="field__error">Fix {problemCount} {problemCount === 1 ? "thing" : "things"} first.</span>;
  else if (last && !connected) status = <span className="t-caption">Connect a wallet to sign your entry.</span>;
  else if (last) status = <span className="t-caption">You'll sign one free message. No gas.</span>;
  else if (missing) status = <span className="t-caption">{missing} {missing === 1 ? "field" : "fields"} left in this step</span>;
  else status = <span className="t-caption wnav__ok">✓ Step complete</span>;

  return (
    <div className="wnav">
      <button type="button" className="btn btn--ghost wnav__back" onClick={onBack} disabled={step === 0} aria-label="Previous step" style={step === 0 ? { visibility: "hidden" } : undefined}>
        <span aria-hidden="true">←</span>
        <span className="wnav__hide">Back</span>
      </button>
      <motion.div key={nudge} className="wnav__status" role="status" aria-live="polite" animate={nudge && missing ? { x: [0, -6, 6, -3, 0] } : {}} transition={{ duration: 0.35 }}>
        {status}
      </motion.div>
      {!last ? (
        <button type="button" className="btn btn--primary btn--arrow" onClick={onNext}>
          <span>
            Next<span className="wnav__hide">: {nextStep.short}</span>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ) : connected ? (
        <button type="submit" className={`btn ${problemCount ? "btn--primary" : "btn--crush"} btn--arrow`} disabled={busy}>
          {submitState.phase === "signing" ? "Sign in MetaMask…" : submitState.phase === "saving" ? "Saving…" : "Sign & enter"}
        </button>
      ) : wallet.status === "unavailable" ? (
        <button type="button" className="btn btn--primary" disabled>
          Sign & enter
        </button>
      ) : (
        <button type="button" className="btn btn--oracle" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
          {wallet.status === "connecting" ? "Check MetaMask…" : "Connect wallet"}
        </button>
      )}
    </div>
  );
}

/* ---------- Header ticket ---------- */

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function countdown(ms) {
  if (ms <= 0) return "Closed";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

/** The top of the page: which tournament, how long is left, and what happens after you enter. */
export function SubmitHeader({ event, savedAt }) {
  const now = useNow();
  const deadline = Date.parse(event.deadline);
  const left = deadline - now;
  const urgent = left < 6 * 3600 * 1000;
  const closes = new Date(deadline).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const prizes = event.tracks.filter((t) => t.prize).length;

  return (
    <header className="wticket rise" style={{ "--i": 1 }}>
      <div className="wticket__main">
        <span className="wticket__kicker">
          <span className="wticket__live" aria-hidden="true" />
          Entries open
        </span>
        <h1 className="t-display-lg m0">Submit to {event.name}</h1>
        <p className="t-body m0 muted">Four quick steps. Your fighter levels up as you fill it in.</p>
        <div className="wticket__meta">
          <span className={`wmeta ${urgent ? "wmeta--hot" : ""}`} title={`Closes ${closes}`}>
            <span className="wmeta__k">Closes in</span>
            <span className="wmeta__v t-num">{countdown(left)}</span>
          </span>
          <span className="wmeta">
            <span className="wmeta__k">Tracks</span>
            <span className="wmeta__v t-num">
              {event.tracks.length}
              {prizes ? ` · ${prizes} with prizes` : ""}
            </span>
          </span>
          <span className="wmeta">
            <span className="wmeta__k">Entry</span>
            <span className="wmeta__v">Free · no gas</span>
          </span>
        </div>
      </div>
      <div className="wticket__perf" aria-hidden="true" />
      <div className="wticket__after">
        <span className="wticket__kicker">After you enter</span>
        <ol className="wafter">
          <li>
            <span className="wafter__n wafter__n--crush">1</span>
            <span>
              <strong>We pin your commit</strong>
              <small>at the deadline, so judging is fair</small>
            </span>
          </li>
          <li>
            <span className="wafter__n wafter__n--oracle">2</span>
            <span>
              <strong>Your demo runs live</strong>
              <small>on a laptop and a phone</small>
            </span>
          </li>
          <li>
            <span className="wafter__n wafter__n--sunny">3</span>
            <span>
              <strong>AI judges score it</strong>
              <small>then your fighter enters the bracket</small>
            </span>
          </li>
        </ol>
        <span className="t-caption save-state" data-saved={savedAt ? "true" : "false"}>
          <span className="save-state__dot" aria-hidden="true" />
          {savedAt ? `Draft kept ${savedAt} (until you reload)` : "Kept as you type, until you reload"}
        </span>
      </div>
    </header>
  );
}
