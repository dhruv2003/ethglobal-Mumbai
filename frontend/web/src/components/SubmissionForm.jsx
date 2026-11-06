import { AnimatePresence, motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { bouncy } from "./fx.jsx";
import { EVENT } from "../config/event.js";
import { LIMITS } from "../lib/validate.js";
import { Msg, TextField, useForm } from "./fields.jsx";

/** The whole form: seven fields, one card. */
export function SubmissionForm({ wallet, onSubmit, submitState, problemCount }) {
  const { data, set, errors, showAll } = useForm();
  const selected = data.tracks.selected;
  const full = selected.length >= EVENT.maxTracks;
  const connected = wallet.status === "connected";
  const busy = submitState.phase === "signing" || submitState.phase === "saving";

  const toggle = (id) => {
    if (selected.includes(id)) set("tracks.selected", selected.filter((x) => x !== id));
    else if (!full) set("tracks.selected", [...selected, id]);
  };

  return (
    <form
      className="card form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid2">
        <TextField path="team.name" label="Team name" limit={LIMITS.teamName} autoComplete="organization" />
        <TextField path="project.name" label="Project name" limit={LIMITS.projectName} />
      </div>
      <TextField path="project.pitch" label="Short pitch" limit={LIMITS.pitch} placeholder="One line that sells it" />
      <TextField
        path="project.description"
        label="What it does and how it's built"
        multiline
        limit={LIMITS.description}
        placeholder="The problem, who it's for, and the stack. Judges check this against your code."
      />
      <TextField
        path="code.repoUrl"
        label="GitHub repository"
        type="url"
        inputMode="url"
        mono
        placeholder="https://github.com/team/project"
        help="Public repos only. We pin the exact commit when submissions freeze."
        autoCapitalize="off"
        spellCheck={false}
      />
      <TextField
        path="demo.videoUrl"
        label="Demo video"
        type="url"
        inputMode="url"
        placeholder="https://youtu.be/…"
        help="2 to 4 minutes. A direct video file or a Loom link can be transcribed automatically."
        autoCapitalize="off"
        spellCheck={false}
      />
      <TextField
        path="demo.liveUrl"
        label="Live app (optional)"
        type="url"
        inputMode="url"
        placeholder="https://your-app.xyz"
        help="Where it runs. We test it on a laptop and a phone. Left empty, we use your GitHub repo's homepage."
        autoCapitalize="off"
        spellCheck={false}
      />

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
          help={full ? `That's ${EVENT.maxTracks}. Remove one to pick another.` : "You're always in the running for finalist. Tracks are optional."}
          error={showAll ? errors["tracks.selected"] : undefined}
        />
      </fieldset>

      <div className="submit-row">
        <div className="submit-row__text" role="status" aria-live="polite">
          {submitState.error ? (
            <span className="field__error">✕ {submitState.error}</span>
          ) : !connected ? (
            <span className="t-caption">Connect your wallet to submit. It owns this entry and receives the project's rewards.</span>
          ) : showAll && problemCount ? (
            <span className="field__error">
              ✕ Fix {problemCount} {problemCount === 1 ? "thing" : "things"} before submitting.
            </span>
          ) : (
            <span className="t-caption">
              You'll sign a message in MetaMask (no gas). Submitting confirms you own this work and the arena can show it publicly.
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
