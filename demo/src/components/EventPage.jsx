/* One tournament: its tracks and prizes, entering it, its projects, and its brackets once drawn. */
import { useMemo, useState } from "react";
import { Card, StatusPill } from "@ds/ui.jsx";
import { loadTournaments } from "../lib/arena.js";
import { usePoll } from "../lib/chain.js";
import { cachedEvent, closeEvent, eventIsOpen, getEvent } from "../lib/events.js";
import { useOrganizer } from "../lib/organizer.js";
import { PHASE_LABEL } from "../lib/labels.js";
import { Link } from "../lib/router.jsx";
import { useCountdown } from "./ChainBits.jsx";

const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function EventPage({ id, wallet }) {
  const { data: event, loading, error, refresh } = usePoll(() => getEvent(id), [id], 30000, { key: `event:${id}`, initial: () => cachedEvent(id) });
  const org = useOrganizer(wallet);
  const [closeError, setCloseError] = useState("");
  const close = async () => {
    setCloseError("");
    try {
      if (!org.signedIn) await org.signIn();
      await closeEvent(id);
      await refresh();
    } catch (e) {
      setCloseError(e.message);
    }
  };
  const { data: brackets } = usePoll(loadTournaments, [], 15000, { key: "tournaments" });
  const mine = useMemo(() => (brackets ?? []).filter((b) => b.eventId === id), [brackets, id]);
  const countdown = useCountdown(event && eventIsOpen(event) ? Date.parse(event.deadline) : null);

  if (loading && !event) return <div className="skeleton skeleton--seat" aria-label="Loading tournament" />;
  if (!event)
    return (
      <Card variant="surface" className="empty">
        <span className="t-body muted">We couldn't find that tournament.</span>
        <Link className="btn btn--secondary btn--sm" to="/tournaments">
          See tournaments
        </Link>
      </Card>
    );
  const open = eventIsOpen(event);
  return (
    <div className="stack stack--page">
      <Link to="/tournaments" className="back btn btn--ghost btn--sm">
        ← Tournaments
      </Link>
      <header className="intro intro--row">
        <div className="intro">
          <span className="org-roles">
            <StatusPill tone={open ? "live" : "neutral"}>{open ? "Open for submissions" : "Submissions closed"}</StatusPill>
          </span>
          <h1 className="t-display-lg m0 rise">{event.name}</h1>
          <p className="t-body m0 muted">
            {event.tracks.length} {event.tracks.length === 1 ? "track" : "tracks"} · submissions {open ? "close" : "closed"} {when(event.deadline)}
          </p>
        </div>
        {countdown && countdown.left > 0 && (
          <div className="lobby-clock">
            <span className="t-caption">Submissions close in</span>
            <span className="t-display-md t-num">{countdown.text}</span>
          </div>
        )}
      </header>
      <div className="org-actions">
        {open && (
          <Link className="btn btn--primary btn--arrow" to={`/tournaments/${encodeURIComponent(event.id)}/submit`}>
            Submit your project <span aria-hidden="true">→</span>
          </Link>
        )}
        <Link className="btn btn--secondary" to={`/projects?tournament=${encodeURIComponent(event.id)}`}>
          See the projects
        </Link>
        {open && org.isOrganizer && (
          <button type="button" className="btn btn--secondary" onClick={close}>
            Close submissions now
          </button>
        )}
      </div>
      {closeError && <p className="field__error" role="alert">{closeError}</p>}
      <Card variant="surface" className="stack">
        <h2 className="t-heading m0">Tracks and prizes</h2>
        <ul className="rules t-body">
          {event.tracks.map((t) => (
            <li key={t.id}>
              <b>{t.name}</b>
              {t.prize ? ` · ${t.prize}` : ""}
            </li>
          ))}
        </ul>
        <p className="t-caption m0">Every project also fights in the overall finalist bracket. Each track needs at least 2 projects to run.</p>
      </Card>
      <section className="stack" aria-label="Brackets">
        <h2 className="t-heading m0">Brackets</h2>
        {mine.length ? (
          <ul className="open-pools">
            {mine.map((b) => (
              <li key={b.id}>
                <Link to={`/tournaments/${b.id}`} className="open-pool">
                  <span className="open-pool__text">
                    <span className="t-body-strong">{b.track}</span>
                    <span className="t-caption">{b.count} projects</span>
                  </span>
                  <StatusPill tone={PHASE_LABEL[b.phase].tone}>{PHASE_LABEL[b.phase].word}</StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Card variant="surface" className="empty">
            <span className="t-body muted">{open ? "Brackets are drawn automatically when submissions close." : "Reviews are finishing. Brackets appear here automatically."}</span>
          </Card>
        )}
      </section>
    </div>
  );
}
