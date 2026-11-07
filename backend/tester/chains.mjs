/*
 * Public chains the test tools know, with a public RPC each. Shared by the live test's
 * wallet (tester/wallet.mjs) and the contract tests' fork endpoints (reviewer/contracts.mjs).
 *
 * Only these URLs are ever called on a project's behalf: never an RPC URL a project supplies.
 * Override with TEST_RPC_URLS='{"84532":"https://..."}' (JSON, chain id -> https URL).
 */
export const CHAINS = {
  1: { name: "Ethereum", alias: "mainnet", rpc: "https://ethereum-rpc.publicnode.com" },
  11155111: { name: "Sepolia", alias: "sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com" },
  8453: { name: "Base", alias: "base", rpc: "https://mainnet.base.org" },
  84532: { name: "Base Sepolia", alias: "base_sepolia", rpc: "https://sepolia.base.org" },
  10: { name: "OP Mainnet", alias: "optimism", rpc: "https://mainnet.optimism.io" },
  11155420: { name: "OP Sepolia", alias: "optimism_sepolia", rpc: "https://sepolia.optimism.io" },
  42161: { name: "Arbitrum One", alias: "arbitrum", rpc: "https://arb1.arbitrum.io/rpc" },
  421614: { name: "Arbitrum Sepolia", alias: "arbitrum_sepolia", rpc: "https://sepolia-rollup.arbitrum.io/rpc" },
  137: { name: "Polygon", alias: "polygon", rpc: "https://polygon-bor-rpc.publicnode.com" },
  80002: { name: "Polygon Amoy", alias: "amoy", rpc: "https://rpc-amoy.polygon.technology" },
};

try {
  for (const [id, url] of Object.entries(JSON.parse(process.env.TEST_RPC_URLS ?? "{}"))) {
    if (!/^https:\/\//.test(String(url)) || !CHAINS[id]) continue;
    CHAINS[id].rpc = String(url);
  }
} catch {
  /* a malformed override is ignored: the defaults stay */
}

export const rpcOf = (chainId) => CHAINS[chainId]?.rpc ?? null;
export const chainName = (chainId) => CHAINS[chainId]?.name ?? `chain ${chainId}`;
