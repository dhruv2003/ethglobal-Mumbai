/*
 * DEMO BUILD: a simulated wallet. "Connect" gives the demo judge's address on the target
 * network at once; signing returns a placeholder signature. Nothing leaves the browser.
 */
import { useCallback, useEffect, useState } from "react";
import { DEMO_ADDRESS } from "./demo/sim.js";
import { EVENT } from "../config/event.js";

export function getProvider() {
  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!eth) return null;
  // Several extensions can share window.ethereum; prefer MetaMask.
  if (Array.isArray(eth.providers) && eth.providers.length)
    return eth.providers.find((p) => p.isMetaMask) ?? eth.providers[0];
  return eth;
}

export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** On a phone without an injected wallet, open this page inside MetaMask's browser. */
export const metamaskDeepLink = () => `https://metamask.app.link/dapp/${location.host}${location.pathname}`;

export const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

const CHAIN_NAMES = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum One",
  11155111: "Ethereum Sepolia",
  84532: "Base Sepolia",
  11155420: "Optimism Sepolia",
  421614: "Arbitrum Sepolia",
  80002: "Polygon Amoy",
};
export const chainName = (id) => CHAIN_NAMES[id] ?? `Chain ${id}`;

function friendlyError(err) {
  if (err?.code === 4001) return "You closed the MetaMask request. Try again when you're ready.";
  if (err?.code === -32002) return "MetaMask already has a request open. Check the extension.";
  return err?.message ? `MetaMask said: ${err.message}` : "Something went wrong talking to MetaMask.";
}

// One wallet for the whole tab: connecting on one page keeps you connected on the next.
let connected = false;
const listeners = new Set();
const setConnected = (v) => {
  connected = v;
  listeners.forEach((fn) => fn(v));
};

export function useWallet() {
  const [on, setOn] = useState(connected);
  const [status, setStatus] = useState(connected ? "connected" : "disconnected");
  const [error, setError] = useState("");
  useEffect(() => {
    const fn = (v) => {
      setOn(v);
      setStatus(v ? "connected" : "disconnected");
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  const connect = useCallback(async () => {
    setError("");
    setStatus("connecting");
    await new Promise((r) => setTimeout(r, 500));
    setConnected(true);
  }, []);
  const disconnect = useCallback(async () => setConnected(false), []);
  const switchNetwork = useCallback(async () => {}, []);
  const sign = useCallback(async () => `0x${"5d".repeat(65)}`, []);

  return {
    status,
    address: on ? DEMO_ADDRESS : "",
    chainId: EVENT.network.chainId,
    error,
    clearError: () => setError(""),
    onTargetNetwork: true,
    connect,
    disconnect,
    switchNetwork,
    sign,
    friendlyError,
    demo: true,
  };
}
