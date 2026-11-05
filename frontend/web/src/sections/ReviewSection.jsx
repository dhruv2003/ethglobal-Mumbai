import { StatusPill } from "@ds/ui.jsx";
import { Checkbox, useForm } from "../components/fields.jsx";
import { scrollToId } from "../components/SideNav.jsx";
import { SECTIONS } from "../lib/validate.js";

export function ReviewSection({ wallet, statuses, onSubmit, submitState, problemCount }) {
  const { showAll } = useForm();
  const busy = submitState.phase === "signing" || submitState.phase === "saving";
  const connected = wallet.status === "connected";
  const label =
    submitState.phase === "signing" ? "Sign in MetaMask…" : submitState.phase === "saving" ? "Saving…" : "Submit project";

  return (
    <section id="review" className="card sec" aria-labelledby="review-h">
      <h2 id="review-h" className="t-display-md">Review</h2>
      <ul className="review-list">
        {SECTIONS.filter((s) => s.id !== "review").map((s) => {
          const st = statuses[s.id];
          return (
            <li key={s.id}>
              <button type="button" className="review-row" onClick={() => scrollToId(s.id)}>
                <span className="t-body-strong">{s.title}</span>
                {st.done ? (
                  <StatusPill tone="success">✓ Ready</StatusPill>
                ) : st.problems && showAll ? (
                  <StatusPill tone="danger">✕ {st.problems} to fix</StatusPill>
                ) : (
                  <StatusPill tone="neutral">{st.label}</StatusPill>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <Checkbox path="consent">
        We own this work, and the arena can show our files, video and code publicly.
      </Checkbox>

      <div className="submit-row">
        <div className="submit-row__text" role="status" aria-live="polite">
          {submitState.error ? (
            <span className="field__error">✕ {submitState.error}</span>
          ) : !connected ? (
            <span className="t-caption">Connect your wallet to submit. You'll sign once to prove it's yours. No gas, no tokens.</span>
          ) : showAll && problemCount ? (
            <span className="field__error">
              ✕ Fix {problemCount} {problemCount === 1 ? "thing" : "things"} before submitting.
            </span>
          ) : (
            <span className="t-caption">You'll sign a message in MetaMask. No gas, no tokens. You can edit until freeze.</span>
          )}
        </div>
        {connected ? (
          <button type="button" className="btn btn--primary" onClick={onSubmit} disabled={busy}>
            {label}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled>
            Submit project
          </button>
        )}
      </div>
    </section>
  );
}
