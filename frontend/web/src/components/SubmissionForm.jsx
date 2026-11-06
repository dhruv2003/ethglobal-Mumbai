import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { bouncy } from "./fx.jsx";
import { EVENT } from "../config/event.js";
import { LIMITS } from "../lib/validate.js";
import { Msg, TextField, useForm } from "./fields.jsx";
import { DemoVideoField } from "./DemoVideoField.jsx";

/** The whole form: seven fields, one card. */
export function SubmissionForm({ wallet, onSubmit, submitState, problemCount }) {
  const { data, set, errors, showAll } = useForm();
  const selected = data.tracks.selected;
  const full = selected.length >= EVENT.maxTracks;
  const connected = wallet.status === "connected";
  const busy = submitState.phase === "signing" || submitState.phase === "saving";

  const done = (paths) => paths.every((p) => !errors[p]);

  const toggle = (id) => {
    if (selected.includes(id)) set("tracks.selected", selected.filter((x) => x !== id));
    else if (!full) set("tracks.selected", [...selected, id]);
  };

  return (
    <form
      className="form form--rounds"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Round n={1} tone="crush" title="The pitch" sub="Who you are and what you built." done={done(["team.name", "project.name", "project.pitch", "project.description"])}>
      <div className="grid2">
        <TextField path="team.name" label="Team name" limit={LIMITS.teamName} autoComplete="organization" />
        <TextField path="project.name" label="Project name" limit={LIMITS.projectName} />
      </div>
      <TextField path="project.pitch" label="Pitch" limit={LIMITS.pitch} placeholder="One line that sells it" />
      <TextField
        path="project.description"
        label="Description"
        multiline
        limit={LIMITS.description}
        placeholder="The problem, who it's for, and how it's built. Judges check this against your code."
      />
      </Round>

      <Round n={2} tone="oracle" title="The proof" sub="Judges read the code and watch the demo." done={done(["code.repoUrl", "demo.videoUrl", "demo.liveUrl"])}>
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
        help="Leave empty to use the repo's homepage."
        autoCapitalize="off"
        spellCheck={false}
      />

      </Round>

      <Round n={3} tone="sunny" title="The arena" sub="Pick up to three sponsor tracks." done={selected.length > 0 && !errors["tracks.selected"]}>
      <fieldset className="field tracks" aria-describedby="f-tracks-selected-msg">
        <legend className="tracks__legend">
          <span>Sponsor tracks</span>
          <StatusPill tone="neutral">
            {selected.length} of {EVENT.maxTracks}
          </StatusPill>
        </legend>
        <div className="chips">
          {EVENT.tracks.map((t) => {
            const on = selected.includes(t.id);
            return (
              <motion.button
                key={t.id}
                type="button"
                className="chip chip--pick"
                aria-pressed={on}
                aria-disabled={!on && full}
                onClick={() => toggle(t.id)}
                whileTap={!on && full ? { x: [0, -4, 4, -2, 0] } : { scale: 0.92 }}
                layout
                transition={bouncy}
              >
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.span className="chip__check" initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={bouncy} aria-hidden="true">
                      ✓
                    </motion.span>
                  )}
                </AnimatePresence>
                {t.name}
              </motion.button>
            );
          })}
        </div>
        <Msg
          id="f-tracks-selected-msg"
          help={full ? `That's ${EVENT.maxTracks}. Remove one to pick another.` : "Optional. Every project competes for finalist."}
          error={showAll ? errors["tracks.selected"] : undefined}
        />
      </fieldset>
      </Round>

      <div className="card submit-row submit-bar">
        <div className="submit-row__text" role="status" aria-live="polite">
          {submitState.error ? (
            <span className="field__error">✕ {submitState.error}</span>
          ) : !connected ? (
            <span className="t-caption">Connect a wallet to submit. It receives any prizes.</span>
          ) : showAll && problemCount ? (
            <span className="field__error">
              ✕ Fix {problemCount} {problemCount === 1 ? "thing" : "things"} before submitting.
            </span>
          ) : (
            <span className="t-caption">
              You'll sign a free message to confirm you own this project.
            </span>
          )}
        </div>
        {connected ? (
          <button type="submit" className={`btn ${problemCount ? "btn--primary" : "btn--crush"} btn--arrow`} disabled={busy}>
            {submitState.phase === "signing" ? "Sign in MetaMask…" : submitState.phase === "saving" ? "Saving…" : "Submit project"}
          </button>
        ) : wallet.status === "unavailable" ? (
          <button type="button" className="btn btn--primary" disabled>
            Submit project
          </button>
        ) : (
          <button type="button" className="btn btn--oracle" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
            {wallet.status === "connecting" ? "Check MetaMask…" : "Connect wallet"}
          </button>
        )}
      </div>
    </form>
  );
}

/** One numbered round of the form; the number turns into a tick when it's complete. */
function Round({ n, tone, title, sub, done, children }) {
  return (
    <section className={`card round round--${tone} rise`} style={{ "--i": n + 2 }} aria-labelledby={`round-${n}`}>
      <header className="round__head">
        <span className={`round__num ${done ? "round__num--done" : ""}`} aria-hidden="true">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={done ? "done" : "n"} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0, rotate: 90 }} transition={bouncy}>
              {done ? "✓" : n}
            </motion.span>
          </AnimatePresence>
        </span>
        <div className="round__title">
          <span className="t-label">Round {n}</span>
          <h2 id={`round-${n}`} className="t-heading m0">
            {title}
            {done && <span className="visually-hidden"> (complete)</span>}
          </h2>
          <p className="t-caption m0">{sub}</p>
        </div>
      </header>
      <div className="round__body">{children}</div>
    </section>
  );
}
