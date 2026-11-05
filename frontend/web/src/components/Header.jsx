import { useEffect, useState } from "react";
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

export function Header({ wallet, route }) {
  const install = useInstallPrompt();
  const onProjects = route.name === "projects" || route.name === "project";
  return (
    <header className="top">
      <div className="top__left">
        <Link to="/" className="brand">
          <svg className="brand__mark" viewBox="0 0 512 512" aria-hidden="true">
            <rect width="512" height="512" rx="112" fill="#17141f" />
            <circle cx="200" cy="256" r="118" fill="#ff5c93" />
            <circle cx="312" cy="256" r="118" fill="#2f4bf0" stroke="#17141f" strokeWidth="20" />
            <circle cx="256" cy="120" r="34" fill="#ffd43b" />
          </svg>
          Battle Arena
        </Link>
        <nav className="top__nav" aria-label="Main">
          <Link to="/projects" aria-current={onProjects ? "page" : undefined}>
            Projects
          </Link>
          <Link to="/submit" aria-current={route.name === "form" ? "page" : undefined}>
            Submit
          </Link>
        </nav>
      </div>
      <div className="top__right">
        {install && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={install}>
            Install app
          </button>
        )}
        <NetworkStatus wallet={wallet} />
        <WalletButton wallet={wallet} />
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
