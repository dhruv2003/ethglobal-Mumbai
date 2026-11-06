/*
 * DEMO DATA, used only as a labelled fallback when live data (chain, backend) cannot be reached. Never mixed with real data;
 * betting and every money action stay off for it.
 */
import { bracketRounds, feeders, matchRound, roundName } from "./pools.js";

const NAMES = [
  "StepQuest", "SplitPay", "Go Health Me", "ChainChef", "PixelPact", "OnchainOracle", "MeshMarket", "GasGhost",
  "RentRoll", "ZKnock", "AgentAtlas", "PocketPals", "DAOdle", "BlockBazaar", "VoteVault", "CarbonCoop",
];
const TRACKS = ["base", "uniswap", "ens", "world", "chainlink", "polygon", "filecoin", "the-graph"];

const PITCHES = {
  StepQuest: "A fitness game that rewards daily steps",
  SplitPay: "AI agents that split USDC payments",
  "Go Health Me": "Crowdfunding for medical bills",
  ChainChef: "Recipes that pay their authors",
};

export const mockProject = (slug, i) => ({
  id: `${slug}-${i}`,
  name: NAMES[i % NAMES.length],
  pitch: PITCHES[NAMES[i % NAMES.length]] ?? "A hackathon project ready for the ring",
  tracks: [TRACKS[i % TRACKS.length]],
});

export const CRITERIA_NAMES = ["Product", "UI", "Engineering", "Innovation", "Feasibility", "Defense"];

/** Stable pseudo-random numbers so a sample looks the same on every visit. */
const noise = (seed) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

function buildMatches(slug, count, phase) {
  const projects = Array.from({ length: count }, (_, i) => mockProject(slug, i));
  const matches = [];
  for (let i = 0; i < count - 1; i++) {
    const feed = feeders(i, count);
    const a = feed ? matches[feed[0]]?.winner ?? null : i * 2;
    const b = feed ? matches[feed[1]]?.winner ?? null : i * 2 + 1;
    const { size } = matchRound(i, count);
    const firstRound = !feed;
    let status = "scheduled";
    if (phase === "completed") status = "finalized";
    if (phase === "canceled") status = firstRound && i < 2 ? "finalized" : "void";
    if (phase === "live" && firstRound) status = i === 5 ? "review" : "live";
    const healthA = 62 + Math.round(noise(i + count) * 30);
    const healthB = 60 + Math.round(noise(i + count + 7) * 30);
    const winner = status === "finalized" && a != null && b != null ? (healthA >= healthB ? a : b) : null;
    matches.push({
      index: i,
      roundName: roundName(size),
      a,
      b,
      status,
      roundIndex: status === "live" ? i % 5 : 4,
      healthA: status === "scheduled" ? 100 : status === "review" ? 72 : healthA,
      healthB: status === "scheduled" ? 100 : status === "review" ? 72 : healthB,
      winner,
    });
  }
  const last = matches[matches.length - 1];
  return { projects, matches, champion: phase === "completed" ? last.winner : null };
}

const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

const make = (slug, title, track, prize, count, phase, startHours, poolTotal) => ({
  demo: true,
  mock: true,
  id: slug,
  title,
  track,
  prize,
  count,
  phase,
  startsAt: inHours(startHours),
  poolTotal,
  rounds: bracketRounds(count),
  ...buildMatches(slug, count, phase),
});

// Prize pools are the partner totals listed on the ETHGlobal Mumbai prizes page. The fights are samples.
export const MOCK_TOURNAMENTS = [
  make("mumbai-finalists", "Mumbai Finalist Showdown", "Finalists", "Finalist prizes", 16, "live", -0.2, 12480),
  make("uniswap-brawl", "Uniswap Track Brawl", "Uniswap", "$15,000", 8, "live", -0.1, 4210),
  make("world-wrangle", "World Track Wrangle", "World", "$12,500", 8, "upcoming", 3, 1875),
  make("ens-rumble", "ENS Track Rumble", "ENS", "$10,000", 4, "upcoming", 8, 320),
  make("chainlink-cup", "Chainlink Cup", "Chainlink", "$5,000", 8, "completed", -26, 6720),
  make("hedera-open", "Hedera Open", "Hedera", "$15,000", 4, "canceled", -12, 540),
];

export const findMockTournament = (id) => MOCK_TOURNAMENTS.find((t) => t.id === id) ?? null;

