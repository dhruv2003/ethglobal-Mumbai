import { useEffect, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { Link } from "../lib/router.jsx";
import { chainName, isMobile, metamaskDeepLink, shortAddress } from "../lib/wallet.js";

/** Chrome/Edge/Android fire beforeinstallprompt; iOS installs via Share > Add to Home Screen. */
function useInstallPrompt() {
  const [evt, setEvt] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setEvt(e);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return evt
    ? async () => {
        evt.prompt();
        await evt.userChoice;
        setEvt(null);
      }
    : null;
}

/** The logo: two overlapping rings (people + protocol) and a sunny token. Orbits on hover. */
export function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#17141f" />
      <circle className="brand__a" cx="200" cy="256" r="118" fill="#ff5c93" />
      <circle className="brand__b" cx="312" cy="256" r="118" fill="#2f4bf0" stroke="#17141f" strokeWidth="20" />
      <circle className="brand__token" cx="256" cy="120" r="34" fill="#ffd43b" />
    </svg>
  );
}

const NAV = [
  { to: "/projects", label: "Projects", on: (r) => r.name === "projects" || r.name === "project" },
  { to: "/submit", label: "Submit", on: (r) => r.name === "form" },
  { to: "/judge", label: "Judges", on: (r) => r.name === "judges" },
  { to: "/storage", label: "0G Storage", on: (r) => r.name === "storage" },
];

export function Header({ wallet, route }) {
  const install = useInstallPrompt();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));
  const [hover, setHover] = useState(null);
  const current = NAV.find((n) => n.on(route))?.to ?? null;
  const pill = hover ?? current;
  return (
    <header className={`top ${scrolled ? "top--scrolled" : ""}`}>
      <div className="top__left">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand__word">
            Battle&nbsp;<span className="brand__accent">Arena</span>
          </span>
        </Link>
        <nav className="top__nav" aria-label="Main" onPointerLeave={() => setHover(null)}>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={pill === n.to && n.to === current ? "is-lit" : undefined} aria-current={n.to === current ? "page" : undefined} onPointerEnter={() => setHover(n.to)} onFocus={() => setHover(n.to)} onBlur={() => setHover(null)}>
              {pill === n.to && (
                <motion.span
                  layoutId="nav-pill"
                  className={`top__pill ${n.to === current ? "top__pill--current" : ""}`}
                  transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  aria-hidden="true"
                />
              )}
              <span className="top__label">{n.label}</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className="top__right">
        {install && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={install}>
            Install app
          </button>
        )}
        <NetworkStatus wallet={wallet} />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={wallet.status}
            initial={{ opacity: 0, scale: 0.85, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 6 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          >
            <WalletButton wallet={wallet} />
          </motion.div>
        </AnimatePresence>
      </div>
    </header>
  );
}

function NetworkStatus({ wallet }) {
  if (wallet.status !== "connected" || wallet.chainId == null) {
    return <StatusPill tone="neutral">{EVENT.network.name} · testnet</StatusPill>;
  }
  if (wallet.onTargetNetwork) return <StatusPill tone="live">{EVENT.network.name}</StatusPill>;
  return (
    <button type="button" className="btn btn--secondary btn--sm hide-sm" onClick={wallet.switchNetwork} title={`You're on ${chainName(wallet.chainId)}`}>
      Switch to {EVENT.network.name}
    </button>
  );
}

function WalletButton({ wallet }) {
  if (wallet.status === "unavailable") {
    return isMobile() ? (
      <a className="btn btn--oracle btn--sm" href={metamaskDeepLink()}>
        Open in MetaMask
      </a>
    ) : (
      <a className="btn btn--oracle btn--sm" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Get MetaMask
      </a>
    );
  }
  if (wallet.status === "connected") {
    return (
      <div className="wallet-on">
        <span className="wallet-on__addr t-mono" title={wallet.address}>
          <span className="wallet-on__dot" aria-hidden="true" />
          {shortAddress(wallet.address)}
        </span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={wallet.disconnect}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="btn btn--oracle btn--sm" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
      {wallet.status === "connecting" ? "Check MetaMask…" : "Connect wallet"}
    </button>
  );
}
