/*
 * The Testing tab's wallet panel: what the app asked the MetaMask-compatible test wallet
 * for, per device, each request linked to its moment in the recording.
 */
import { useState } from "react";
import { Icon } from "../Icon.jsx";
import { clock } from "./testRun.js";

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

function describe(e) {
  switch (e.type) {
    case "connect":
      return { mark: "✓", tone: "good", text: "Asked for an account: connected" };
    case "signature":
      return { mark: "✎", tone: "good", text: `Signed a ${e.what}`, more: e.preview };
    case "transaction": {
      const sim = e.simulation ?? {};
      const to = e.to ? `to ${short(e.to)}` : e.deploy ? "deploying a contract" : "";
      const value = e.value && e.value !== "0" ? ` · ${e.value}` : "";
      return {
        mark: "⇢",
        tone: sim.ok === false ? "warn" : "good",
        text: `Asked to send a transaction ${to}${value}`,
        more: `${e.selector ? `function ${e.selector} · ` : ""}${sim.ok === true ? `simulation: would succeed${sim.gas ? ` (${sim.gas.toLocaleString("en")} gas)` : ""}` : sim.ok === false ? `simulation: would revert (${sim.reason})` : "not simulated"} · rejected by the test wallet, never sent`,
      };
    }
    case "switch-chain":
      return { mark: "⇄", tone: "skip", text: `Switched network to ${e.toName ?? `chain ${e.to}`}` };
    case "chain-refused":
      return { mark: "!", tone: "warn", text: `Asked for a network the test wallet doesn't have (${e.name ?? e.to})` };
    case "watch-asset":
      return { mark: "+", tone: "skip", text: `Asked to add token ${e.asset}` };
    case "refused":
    case "unsupported":
      return { mark: "–", tone: "skip", text: `Asked for ${e.method}: not supported by the test wallet` };
    default:
      return { mark: "·", tone: "skip", text: e.type };
  }
}

export function WalletLog({ runs, onSeek }) {
  const withWallet = runs.filter((r) => r.wallet);
  const [dev, setDev] = useState(withWallet[0]?.device);
  if (!withWallet.length) return null;
  const r = withWallet.find((x) => x.device === dev) ?? withWallet[0];
  const w = r.wallet;
  return (
    <section className="rv-card wlog" aria-labelledby="wlog-h">
      <header className="rv-card__head">
        <h3 id="wlog-h" className="m0">
          Wallet (MetaMask)
        </h3>
        <span className="ct__pills">
          <span className={`tpill ${w.connected ? "tpill--good" : "tpill--bad"}`}>{w.connected ? "✓ Connected" : "✕ Didn't connect"}</span>
          {withWallet.length > 1 && (
            <span className="tart__dev" role="group" aria-label="Device">
              {withWallet.map((x) => (
                <button key={x.device} type="button" aria-pressed={x.device === r.device} onClick={() => setDev(x.device)} aria-label={x.label}>
                  <Icon name={x.device} size={15} />
                </button>
              ))}
            </span>
          )}
        </span>
      </header>
      <p className="m0 rv-card__sub">
        A MetaMask-compatible test wallet ({short(w.address)}, a throwaway key with no funds) was offered to the app on {w.startChain?.name}
        {w.endChain?.id !== w.startChain?.id ? `, which moved it to ${w.endChain?.name}` : ""}. It signs messages; every transaction is simulated and then rejected, so nothing is ever sent.
      </p>
      {w.events?.length ? (
        <ol className="wlog__list m0">
          {w.events.map((e, i) => {
            const d = describe(e);
            return (
              <li key={i} className={`wlog__ev wlog__ev--${d.tone}`}>
                <button type="button" className="wlog__at t-num" onClick={() => e.at != null && onSeek(r.device, e.at)} disabled={e.at == null} title="Play from here">
                  {e.at != null ? clock(e.at) : "—"}
                </button>
                <span className="wlog__mark" aria-hidden="true">
                  {d.mark}
                </span>
                <span className="wlog__text">
                  {d.text}
                  {d.more && <small>{d.more}</small>}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m0 rv-card__sub">The app never asked the wallet for anything.</p>
      )}
    </section>
  );
}
