/*
 * Event configuration. In the full product the organizer sets this (PRD ORG-01);
 * until the backend exists it lives here.
 *
 * PLACEHOLDERS: the network (PRD 18.2, not decided yet) and the track list.
 * Replace both with the real values before the event.
 */
const env = import.meta.env ?? {};

export const CONTRACTS = {
  token: env.VITE_TOKEN_ADDRESS || "0x564B51f96406328Ad3dBD6E89b63219938F4fbb7",
  manager: env.VITE_TOURNAMENT_MANAGER_ADDRESS || "0x45cdb8fc0b250f70f56675e8b6c0c25ac6bd6c03",
  pools: env.VITE_BETTING_POOLS_ADDRESS || "0xb73e35494272ec09044893c585b40e0cedb7eb95",
};

export const EVENT = {
  name: "ETHGlobal Mumbai",
  startDate: "2026-11-06",
  // Set these in frontend/web/.env (see .env.example) to change chain.
  network: {
    name: env.VITE_CHAIN_NAME || "Base Sepolia",
    chainId: Number(env.VITE_CHAIN_ID || 84532),
    rpcUrl: env.VITE_RPC_URL || "https://sepolia.base.org",
    explorerUrl: env.VITE_EXPLORER_URL || "https://sepolia.basescan.org",
    symbol: env.VITE_NATIVE_SYMBOL || "ETH",
  },
  maxTracks: 3,
  tracks: [
    { id: "base", name: "Base" },
    { id: "the-graph", name: "The Graph" },
    { id: "chainlink", name: "Chainlink" },
    { id: "world", name: "World" },
    { id: "polygon", name: "Polygon" },
    { id: "filecoin", name: "Filecoin" },
    { id: "uniswap", name: "Uniswap" },
    { id: "ens", name: "ENS" },
  ],
};
