/* Small pieces every contract screen shares: connect prompt, transaction status, animated numbers. */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { Button, StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { addressUrl, txUrl } from "../lib/chain.js";
import { chainName, isMobile, metamaskDeepLink, shortAddress } from "../lib/wallet.js";
import { bouncy, easeOut } from "./fx.jsx";

/** Counts up to a new value. The final value is what screen readers get. */
export function AnimatedNumber({ value, format = (v) => v.toLocaleString("en-US", { maximumFractionDigits: 2 }), className = "" }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    if (reduced || previous.current === value) {
      previous.current = value;
      setShown(value);
      return undefined;
    }
    const controls = animate(previous.current, value, { duration: 0.7, ease: easeOut, onUpdate: setShown });
    previous.current = value;
    return () => controls.stop();
  }, [value, reduced]);
  return (
    <span className={`t-num ${className}`} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}

/** Asks the visitor to connect or switch network. Renders nothing once they're ready. */
export function WalletGate({ wallet, reason = "to use this" }) {
  const unavailable = wallet.status === "unavailable";
  const wrongNetwork = wallet.status === "connected" && !wallet.onTargetNetwork;
  if (wallet.status === "connected" && wallet.onTargetNetwork) return null;
  return (
    <motion.div className="gate" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={bouncy}>
      <span className="t-body-strong">
        {unavailable ? "MetaMask isn't installed" : wrongNetwork ? `You're on ${chainName(wallet.chainId)}` : `Connect MetaMask ${reason}`}
      </span>
      {unavailable ? (
        <a className="btn btn--oracle" href={isMobile() ? metamaskDeepLink() : "https://metamask.io/download/"} target="_blank" rel="noreferrer">
          {isMobile() ? "Open in MetaMask" : "Get MetaMask"}
        </a>
      ) : wrongNetwork ? (
        <Button variant="oracle" onClick={wallet.switchNetwork}>
          Switch to {EVENT.network.name}
        </Button>
      ) : (
        <Button variant="oracle" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
          {wallet.status === "connecting" ? "Check MetaMask…" : "Connect MetaMask"}
        </Button>
      )}
    </motion.div>
  );
}

const TX_TONE = {
  sign: { tone: "neutral", word: "Waiting for you" },
  pending: { tone: "live", word: "Pending" },
  confirmed: { tone: "success", word: "Confirmed" },
  failed: { tone: "danger", word: "Failed" },
};

/** Live status of the current transaction, with a link to the explorer. */
export function TxStatus({ tx, onDismiss }) {
  const label = TX_TONE[tx.phase];
  return (
    <AnimatePresence initial={false}>
      {label && (
        <motion.div
          key={tx.phase}
          className={`tx tx--${tx.phase}`}
          role={tx.phase === "failed" ? "alert" : "status"}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, height: 0, marginTop: 0 }}
          transition={bouncy}
        >
          <StatusPill tone={label.tone}>{label.word}</StatusPill>
          <span className="tx__message t-body">{tx.message}</span>
          {tx.hash && (
            <a className="t-mono-caption tx__link" href={txUrl(tx.hash)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
          )}
          {(tx.phase === "confirmed" || tx.phase === "failed") && onDismiss && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AddressLink({ address, className = "" }) {
  return (
    <a className={`t-mono-caption addr-link ${className}`} href={addressUrl(address)} target="_blank" rel="noreferrer" title={address}>
      {shortAddress(address)} ↗
    </a>
  );
}

/** Ticks once a second. Advisory only: the contract's chain time decides. */
export function useCountdown(targetMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!targetMs) return null;
  const left = Math.max(0, Math.floor((targetMs - now) / 1000));
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return { left, text: d ? `${d}d ${h}h ${pad(m)}m` : h ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s` };
}

export const TESTNET_NOTE = `Testnet only, on ${EVENT.network.name}. These tokens have no real value.`;
