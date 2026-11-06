import { useEffect, useRef, useState } from "react";
import { useOrganizer } from "../lib/organizer.js";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { EVENT } from "../config/event.js";
import { Link } from "../lib/router.jsx";
import { chainName, isMobile, metamaskDeepLink, shortAddress } from "../lib/wallet.js";
import { toast } from "./Feedback.jsx";

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

// Three places, in the order of the story: watch the fights, see the evidence, enter your own.
// Tournaments, the graph and storage still open by URL.
export const SUBMIT_PATH = "/tournaments/ethglobal-mumbai/submit";
const NAV = [
  { to: "/arena", label: "Arena", on: (r) => r.name === "arena" || r.name === "matchFight" || r.name === "tournament" || r.name === "tournaments" },
  { to: "/projects", label: "Projects", on: (r) => r.name === "projects" || r.name === "project" },
  { to: "/fighters", label: "Fighters", on: (r) => r.name === "fighters" },
  { to: SUBMIT_PATH, label: "Submit", on: (r) => r.name === "form" || r.name === "event" },
];
const ORGANIZER_NAV = [
  { to: "/judge", label: "Judges", on: (r) => r.name === "judges" },
  { to: "/organizer", label: "Organizer", on: (r) => r.name === "organizer" },
];
const MANAGE = "manage";

/** A button that opens a small panel. Closes on Escape, on a click outside, and when an item is chosen. */
function Menu({ triggerClass, triggerProps, trigger, align = "start", children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={root}>
      <button type="button" className={`menu__trigger ${triggerClass}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} {...triggerProps}>
        {trigger}
        <svg className="menu__chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={`menu__panel menu__panel--${align}`}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ type: "spring", stiffness: 600, damping: 36 }}
            onClick={(e) => {
              if (e.target.closest("a, button")) setOpen(false);
            }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Header({ wallet, route }) {
  const install = useInstallPrompt();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));
  const [hover, setHover] = useState(null);
  const { isOrganizer } = useOrganizer(wallet);
  const manageOn = isOrganizer && ORGANIZER_NAV.some((n) => n.on(route));
  const current = manageOn ? MANAGE : (NAV.find((n) => n.on(route))?.to ?? null);
  const pill = hover ?? current;
  const pillFor = (key) =>
    pill === key && (
      <motion.span
        layoutId="nav-pill"
        className={`top__pill ${key === current ? "top__pill--current" : ""}`}
        transition={{ type: "spring", stiffness: 500, damping: 38 }}
        aria-hidden="true"
      />
    );
  return (
    <header className={`top ${scrolled ? "top--scrolled" : ""}`}>
      <div className="top__left">
        <Link to="/" className="brand">
          <BrandMark />
          <span className="brand__word">
            Fight<span className="brand__accent">Club</span>
          </span>
        </Link>
        <nav className="top__nav" aria-label="Main" onPointerLeave={() => setHover(null)}>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={pill === n.to && n.to === current ? "is-lit" : undefined} aria-current={n.to === current ? "page" : undefined} onPointerEnter={() => setHover(n.to)} onFocus={() => setHover(n.to)} onBlur={() => setHover(null)}>
              {pillFor(n.to)}
              <span className="top__label">{n.label}</span>
            </Link>
          ))}
          {isOrganizer && (
            <Menu
              triggerClass={`top__manage ${pill === MANAGE && manageOn ? "is-lit" : ""}`}
              triggerProps={{ onPointerEnter: () => setHover(MANAGE), onFocus: () => setHover(MANAGE), onBlur: () => setHover(null) }}
              trigger={
                <>
                  {pillFor(MANAGE)}
                  <span className="top__label">Manage</span>
                </>
              }
            >
              {ORGANIZER_NAV.map((n) => (
                <Link key={n.to} to={n.to} className="menu__item" aria-current={n.on(route) ? "page" : undefined}>
                  {n.label}
                </Link>
              ))}
            </Menu>
          )}
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
            <WalletButton wallet={wallet} route={route} />
          </motion.div>
        </AnimatePresence>
      </div>
    </header>
  );
}

function NetworkStatus({ wallet }) {
  if (wallet.status !== "connected" || wallet.chainId == null) {
    return <StatusPill tone="neutral">{EVENT.network.name}</StatusPill>;
  }
  if (wallet.onTargetNetwork) return <StatusPill tone="live">{EVENT.network.name}</StatusPill>;
  return (
    <button type="button" className="btn btn--secondary btn--sm hide-sm" onClick={wallet.switchNetwork} title={`You're on ${chainName(wallet.chainId)}`}>
      Switch to {EVENT.network.name}
    </button>
  );
}

async function copyAddress(address) {
  try {
    await navigator.clipboard.writeText(address);
    toast("Address copied.", { tone: "success" });
  } catch {
    toast("Couldn't copy the address.", { tone: "warning" });
  }
}

function WalletButton({ wallet, route }) {
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
      <Menu
        align="end"
        triggerClass="wallet-on__addr t-mono"
        triggerProps={{ title: wallet.address, "aria-label": `Wallet menu for ${shortAddress(wallet.address)}` }}
        trigger={
          <>
            <span className="wallet-on__dot" aria-hidden="true" />
            {shortAddress(wallet.address)}
          </>
        }
      >
        <Link to="/wallet" className="menu__item" aria-current={route.name === "wallet" ? "page" : undefined}>
          Wallet
        </Link>
        <Link to="/wallet/transactions" className="menu__item" aria-current={route.name === "transactions" ? "page" : undefined}>
          Transactions
        </Link>
        <span className="menu__rule" aria-hidden="true" />
        <button type="button" className="menu__item" onClick={() => copyAddress(wallet.address)}>
          Copy address
        </button>
        <button type="button" className="menu__item" onClick={wallet.disconnect}>
          Disconnect
        </button>
      </Menu>
    );
  }
  return (
    <button type="button" className="btn btn--oracle btn--sm" onClick={wallet.connect} disabled={wallet.status === "connecting"}>
      {wallet.status === "connecting" ? "Check MetaMask…" : "Connect wallet"}
    </button>
  );
}
