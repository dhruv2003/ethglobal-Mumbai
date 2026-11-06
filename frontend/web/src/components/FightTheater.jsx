/* The full-screen fight view a bettor lands in, and the result card when the fight ends. */
import { useCallback, useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { formatAmount, useToken } from "../lib/chain.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { usePayouts } from "../lib/payouts.js";
import { matchMarket, settledResult } from "../lib/pools.js";
import { navigate } from "../lib/router.jsx";
import { myBet, usePoolData } from "./BetPanel.jsx";
import { Player, WaitingRing, canPlay, matchFor } from "./FightPlayer.jsx";
import { easeOut } from "./fx.jsx";

/** The game view after a bet: the ring at 90% of the screen. What the wallet won comes from the chain, never from the replay. */
export function Theater({ tournament, match, fight, a, b, wallet, onClose }) {
  const fightMatch = useMemo(() => matchFor(tournament, match, fight, a, b), [tournament, match, fight, a, b]);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("no-scroll");
    };
  }, [onClose]);
  const ready = canPlay(fight);
  const happening = ready || fight?.status === "running";
  const info = useToken();
  const payouts = usePayouts();
  const selections = useMemo(() => [{ id: match.a, project: a }, { id: match.b, project: b }], [match.a, match.b, a, b]);
  const { data } = usePoolData(wallet, tournament.id, matchMarket(tournament.id, match.index), selections);
  const [fought, setFought] = useState(false);
  const [run, setRun] = useState(0);
  const onResult = useCallback(() => setFought(true), []);
  const fmt = (v) => formatAmount(v, info.decimals);
  const bet = myBet(data, info, selections);
  const finalized = match.status === "finalized";
  const settled = fought && finalized && data && info ? settledResult({ stakes: data.stakes, mine: data.mine, winnerIndex: match.winner === match.a ? 0 : 1 }) : null;
  const outcome = settled && { kind: settled.kind, amount: fmt(settled.amount), winner: match.winner === match.a ? a.name : b.name, paid: data.paid, auto: payouts.enabled };
  return createPortal(
    <motion.div className="theater" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="theater__frame"
        role="dialog"
        aria-modal="true"
        aria-label={`${a.name} vs ${b.name}`}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: easeOut }}
      >
        <header className="theater__bar">
          <span className="theater__live">
            {happening ? <span className="live-dot" aria-hidden="true" /> : null} {happening ? "Live" : "Waiting"}
          </span>
          <span className="theater__title">
            {a.name} <span className="muted">vs</span> {b.name}
          </span>
          {bet && (
            <span className="theater__bet t-num">
              Your bet · {bet.amount} {bet.symbol} on <b>{bet.name}</b>
            </span>
          )}
          <button type="button" className="bm__close" aria-label="Close the fight view" onClick={onClose}>
            ×
          </button>
        </header>
        {ready ? (
          <Player key={run} fightMatch={fightMatch} events={fight.events} fight={fight} theater onResult={onResult} />
        ) : (
          <div className="theater__stage theater__stage--wait">
            <WaitingRing match={fightMatch} fit />
            <p className="theater__note t-body">{fight?.status === "running" ? "The judges are finishing. The fight plays here as soon as they're done." : "Your bet is in. The fight plays here when it starts."}</p>
          </div>
        )}
        {fought && !finalized && <p className="theater__note t-body">The fight is over. The result is being published on chain.</p>}
        {outcome && <ResultCard outcome={outcome} bet={bet} onClose={onClose} onReplay={() => { setFought(false); setRun((n) => n + 1); }} />}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

const BURST = ["#ffd43b", "#ff5c93", "#2f4bf0", "#17141f"];

/** Two bursts from the sides, then a rain from the top. Skipped for reduced motion. */
function winConfetti() {
  if (prefersReducedMotion()) return;
  const opts = { particleCount: 70, spread: 65, startVelocity: 55, colors: BURST, zIndex: 120, disableForReducedMotion: true };
  confetti({ ...opts, angle: 60, origin: { x: 0.08, y: 0.75 } });
  confetti({ ...opts, angle: 120, origin: { x: 0.92, y: 0.75 } });
  setTimeout(() => confetti({ ...opts, particleCount: 120, spread: 140, startVelocity: 30, origin: { x: 0.5, y: 0.1 } }), 350);
}

/** What the bettor sees when the fight ends: the win (with confetti) or a quiet loss. */
function ResultCard({ outcome, bet, onClose, onReplay }) {
  const won = outcome.kind === "won";
  const refund = outcome.kind === "refund";
  useEffect(() => {
    if (won) winConfetti();
  }, [won]);
  return (
    <motion.div className="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        className={`result__card ${won ? "is-won" : ""}`}
        role="alertdialog"
        aria-labelledby="result-title"
        initial={{ opacity: 0, y: 20, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 22 }}
      >
        <p className="result__eyebrow">{outcome.winner} wins</p>
        <h2 id="result-title" className="result__title">
          {won ? "You won" : refund ? "Your bet comes back" : "Not this time"}
        </h2>
        {won || refund ? (
          <p className="result__amount t-num">
            +{outcome.amount} <span>{bet.symbol}</span>
          </p>
        ) : (
          <p className="result__lost t-num">
            Your {bet.amount} {bet.symbol} on {bet.name} didn't land.
          </p>
        )}
        <p className="result__fine t-num">
          {outcome.paid
            ? "Paid to your wallet."
            : won || refund
              ? outcome.auto
                ? "It's being sent to your wallet automatically."
                : "Collect it on the fight page."
              : "Winners are paid from this pool."}
        </p>
        <div className="result__actions">
          <button type="button" className="bm__go" onClick={() => navigate("/tournaments")}>
            {won ? "Bet on the next fight" : "Try another fight"}
          </button>
          <button type="button" className="result__link" onClick={onReplay}>
            Watch the replay
          </button>
          <button type="button" className="result__link" onClick={onClose}>
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
