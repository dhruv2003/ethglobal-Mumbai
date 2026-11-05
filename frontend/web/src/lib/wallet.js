/*
 * MetaMask over EIP-1193 (window.ethereum). No wallet library.
 */
import { useCallback, useEffect, useState } from "react";
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

export function useWallet() {
  const [provider] = useState(getProvider);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(null);
  const [status, setStatus] = useState(provider ? "disconnected" : "unavailable");
  const [error, setError] = useState("");

  const applyAccounts = useCallback((accounts) => {
    const a = accounts?.[0] ?? "";
    setAddress(a);
    setStatus(a ? "connected" : "disconnected");
  }, []);

  useEffect(() => {
    if (!provider) return;
    // Restore a previous connection silently (no popup).
    provider.request({ method: "eth_accounts" }).then(applyAccounts).catch(() => {});
    provider.request({ method: "eth_chainId" }).then((c) => setChainId(parseInt(c, 16))).catch(() => {});
    const onAccounts = (a) => applyAccounts(a);
    const onChain = (c) => setChainId(parseInt(c, 16));
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider, applyAccounts]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setError("");
    setStatus("connecting");
    try {
      applyAccounts(await provider.request({ method: "eth_requestAccounts" }));
      setChainId(parseInt(await provider.request({ method: "eth_chainId" }), 16));
    } catch (e) {
      setStatus("disconnected");
      setError(friendlyError(e));
    }
  }, [provider, applyAccounts]);

  const disconnect = useCallback(async () => {
    try {
      await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* older MetaMask: forgetting locally is enough */
    }
    applyAccounts([]);
  }, [provider, applyAccounts]);

  const switchNetwork = useCallback(async () => {
    if (!provider) return;
    const n = EVENT.network;
    const hex = `0x${n.chainId.toString(16)}`;
    setError("");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e?.code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hex,
                chainName: n.name,
                rpcUrls: [n.rpcUrl],
                blockExplorerUrls: [n.explorerUrl],
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              },
            ],
          });
        } catch (e2) {
          setError(friendlyError(e2));
        }
      } else setError(friendlyError(e));
    }
  }, [provider]);

  /** personal_sign: proves the connected wallet owns this submission (PRD SUB-04). */
  const sign = useCallback(
    async (message) => {
      const hexMsg = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      return provider.request({ method: "personal_sign", params: [hexMsg, address] });
    },
    [provider, address],
  );

  return {
    status,
    address,
    chainId,
    error,
    clearError: () => setError(""),
    onTargetNetwork: chainId === EVENT.network.chainId,
    connect,
    disconnect,
    switchNetwork,
    sign,
    friendlyError,
  };
}
