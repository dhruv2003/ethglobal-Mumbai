/*
 * Event configuration. In the full product the organizer sets this (PRD ORG-01);
 * until the backend exists it lives here.
 *
 * PLACEHOLDERS: the network (PRD 18.2, not decided yet) and the track list.
 * Replace both with the real values before the event.
 */
export const EVENT = {
  name: "ETHGlobal Mumbai",
  startDate: "2026-11-06",
  network: {
    name: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
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

/** Networks a team can say their contracts are deployed on. */
export const CONTRACT_NETWORKS = [
  "Ethereum Sepolia",
  "Base Sepolia",
  "Optimism Sepolia",
  "Arbitrum Sepolia",
  "Polygon Amoy",
  "Ethereum mainnet",
  "Base",
  "Optimism",
  "Arbitrum One",
  "Polygon PoS",
  "Other",
];

const MB = 1024 * 1024;

/** Upload limits from PRD SUB-02. */
export const LIMITS = {
  image: 20 * MB,
  pdf: 20 * MB,
  text: 20 * MB,
  video: 200 * MB,
  total: 500 * MB,
};

/** ETHGlobal asks for a 2 to 4 minute demo video. */
export const VIDEO_SECONDS = { min: 120, max: 240 };
