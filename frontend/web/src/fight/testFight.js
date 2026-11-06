/*
 * TEST FIGHT: a complete scripted match, used only by the tests. Contract (every event): { seq, ts, type, ...payload }
 *   intro        {}
 *   pitch        { actor, text }
 *   round_start  { round }
 *   question     { round, actor: judgeId, text }
 *   answer       { round, actor, text }
 *   challenge    { round, actor, target, challengeId, move, text, evidence: [{ kind, label }] }
 *   rebuttal     { round, actor, challengeId, text, evidence? }
 *   ruling       { round, challengeId, votes: { judgeId: label }, label?, reason }
 *   penalty      { round, target, judge, reason }
 *   closing      { actor, text }
 *   round_sealed { round, scores: { a: [j1, j2, j3], b: [j1, j2, j3] } }
 *   tie_break    { stage: "start" | "sealed", scores?: { a, b } }   (hundredths)
 *   human_review { status: "pending" | "decided", winner?, rationale?, organizer? }
 *   result       { winner: "a" | "b", reason: "score" | "tie_break" | "organizer" }
 * Labels: upheld | partially_upheld | rejected | inconclusive (mixed is derived).
 */

export const MOCK_MATCH = {
  id: "qf2",
  title: "Quarterfinal 2",
  event: "ETHGlobal Mumbai",
  fighters: {
    a: { id: "stepquest", name: "StepQuest", tracks: ["base"], pitch: "A fitness game that rewards daily steps", description: "Team quests for walking." },
    b: { id: "splitpay-x", name: "SplitPay", tracks: ["uniswap"], pitch: "AI agents that split USDC payments", description: "Agents read the receipt and settle payments." },
  },
  judges: {
    ada: { name: "Ada", focus: "Product" },
    rook: { name: "Rook", focus: "Engineering" },
    nova: { name: "Nova", focus: "Innovation" },
  },
};

const S = [];
const add = (type, payload = {}) => S.push({ type, ...payload });

add("intro");
add("pitch", { actor: "a", text: "StepQuest turns your daily walk into a team quest. Hit the group goal and everyone earns rewards that can't be farmed by bots." });
add("pitch", { actor: "b", text: "SplitPay ends awkward bill maths. Snap the receipt, an agent proposes a fair split, and everyone approves their USDC share in one tap." });

// ---- Round 1: Product ----
add("round_start", { round: "product" });
add("question", { round: "product", actor: "ada", text: "Who is your user, and what do their first five minutes look like?" });
add("answer", { round: "product", actor: "a", text: "Office workers who sit all day. They install, connect the phone's step counter and join a weekly team quest in under two minutes." });
add("answer", { round: "product", actor: "b", text: "Friends splitting group costs. An agent reads the receipt, proposes a split, and each person approves their payment in one tap." });
add("challenge", { round: "product", actor: "a", target: "b", challengeId: "r1a", move: "User Story Sweep", text: "Nobody asked for an AI to decide their split. Where's the evidence users want this?", evidence: [{ kind: "file", label: "README.md:12" }] });
add("rebuttal", { round: "product", actor: "b", challengeId: "r1a", text: "We interviewed nine people who split rent every month. The notes are in the repo.", evidence: [{ kind: "file", label: "research/interviews.md" }] });
add("ruling", { round: "product", challengeId: "r1a", votes: { ada: "rejected", rook: "rejected", nova: "rejected" }, reason: "Interview notes in the snapshot back the user claim." });
add("challenge", { round: "product", actor: "b", target: "a", challengeId: "r1b", move: "Onboarding Hook", text: "StepQuest's demo skips onboarding. The recording starts already logged in.", evidence: [{ kind: "screenshot", label: "demo.mp4 @ 0:04" }] });
add("rebuttal", { round: "product", actor: "a", challengeId: "r1b", text: "Onboarding is two screens. They're in the repo, just not in the video." });
add("ruling", { round: "product", challengeId: "r1b", votes: { ada: "partially_upheld", rook: "partially_upheld", nova: "rejected" }, reason: "The screens exist, but the demo never shows a new user getting started." });
add("penalty", { round: "product", target: "b", judge: "ada", reason: "The pitch says “live on mainnet”, but the snapshot is deployed to testnet only." });
add("round_sealed", { round: "product", scores: { a: [72, 70, 74], b: [64, 66, 61] } });

// ---- Round 2: Engineering ----
add("round_start", { round: "engineering" });
add("question", { round: "engineering", actor: "rook", text: "When a payment or reward call fails halfway, what does your system do, and how do you know it works?" });
add("answer", { round: "engineering", actor: "a", text: "Rewards go to a queue first. A failed mint retries up to three times and every attempt is logged. Tests cover the retry path." });
add("answer", { round: "engineering", actor: "b", text: "Each split is one transaction, so a failure reverts everything. Failed payouts are retried safely by our worker." });
add("challenge", { round: "engineering", actor: "a", target: "b", challengeId: "r2a", move: "Stack Trace Strike", text: "SplitPay says failed payouts retry safely, but there isn't a single retry test in the repo.", evidence: [{ kind: "file", label: "tests/split.spec.ts:88" }, { kind: "test", label: "run #18 · 0 retry cases" }] });
add("rebuttal", { round: "engineering", actor: "b", challengeId: "r2a", text: "Retries come from the queue library's defaults, which are well tested upstream." });
add("ruling", { round: "engineering", challengeId: "r2a", votes: { ada: "upheld", rook: "upheld", nova: "partially_upheld" }, reason: "No project test exercises the retry path. Library defaults are a claim, not evidence." });
add("challenge", { round: "engineering", actor: "b", target: "a", challengeId: "r2b", move: "Trust Exploit", text: "StepQuest's step counts come straight from the phone and are never verified.", evidence: [{ kind: "file", label: "app/steps.ts:41" }] });
add("rebuttal", { round: "engineering", actor: "a", challengeId: "r2b", text: "Counts are signed by the phone's health API, and the server checks the signature.", evidence: [{ kind: "file", label: "server/verify.ts:18" }] });
add("ruling", { round: "engineering", challengeId: "r2b", votes: { ada: "rejected", rook: "rejected", nova: "rejected" }, reason: "The server-side signature check is in the snapshot and tested." });
add("round_sealed", { round: "engineering", scores: { a: [78, 74, 76], b: [62, 65, 60] } });

// ---- Round 3: Innovation ----
add("round_start", { round: "innovation" });
add("question", { round: "innovation", actor: "nova", text: "What can you do that the obvious alternative can't?" });
add("answer", { round: "innovation", actor: "a", text: "Team quests turn steps into a shared game, and daily caps stop the reward farming that sank earlier move-to-earn apps." });
add("answer", { round: "innovation", actor: "b", text: "Agents propose weighted splits from the receipt itself, so nobody has to do the awkward maths or chase friends." });
add("challenge", { round: "innovation", actor: "a", target: "b", challengeId: "r3a", move: "Novelty Check", text: "Bill-splitting apps already exist. Adding a language model isn't a new approach.", evidence: [{ kind: "file", label: "docs/landscape.md" }] });
add("rebuttal", { round: "innovation", actor: "b", challengeId: "r3a", text: "Existing apps split evenly. Ours weights each line item and asks every payer to approve." });
add("ruling", { round: "innovation", challengeId: "r3a", votes: { ada: "inconclusive", rook: "rejected", nova: "inconclusive" }, reason: "Weighted splits are a real difference, but the snapshot doesn't show how often they're used." });
add("challenge", { round: "innovation", actor: "b", target: "a", challengeId: "r3b", move: "Copycat Counter", text: "Move-to-earn games are everywhere. StepQuest's twist is cosmetic." });
add("rebuttal", { round: "innovation", actor: "a", challengeId: "r3b", text: "Team goals and daily caps change the incentives, not just the look." });
add("ruling", { round: "innovation", challengeId: "r3b", votes: { ada: "partially_upheld", rook: "upheld", nova: "rejected" }, reason: "Judges split: the caps are real, the team mechanic is lightly tested." });
add("round_sealed", { round: "innovation", scores: { a: [70, 72, 68], b: [75, 73, 78] } });

// ---- Round 4: Feasibility ----
add("round_start", { round: "feasibility" });
add("question", { round: "feasibility", actor: "ada", text: "Who pays to run this, and what does one active user cost you?" });
add("answer", { round: "feasibility", actor: "a", text: "Employers fund rewards from wellness budgets. Hosting and minting cost about two cents per user per month." });
add("answer", { round: "feasibility", actor: "b", text: "A 0.3% fee on settled splits. Agent calls cost under a cent per receipt." });
add("challenge", { round: "feasibility", actor: "a", target: "b", challengeId: "r4a", move: "Runway Check", text: "Agent calls cost money on every split, and there's no fee logic anywhere in the code.", evidence: [{ kind: "file", label: "contracts/Split.sol" }] });
add("rebuttal", { round: "feasibility", actor: "b", challengeId: "r4a", text: "The fee is documented and planned for the next contract version.", evidence: [{ kind: "file", label: "docs/costs.md" }] });
add("ruling", { round: "feasibility", challengeId: "r4a", votes: { ada: "partially_upheld", rook: "partially_upheld", nova: "upheld" }, reason: "The model is written down but not built." });
add("challenge", { round: "feasibility", actor: "b", target: "a", challengeId: "r4b", move: "Budget Drain", text: "Sponsor rewards dry up after the hackathon. Who funds the token then?" });
add("rebuttal", { round: "feasibility", actor: "a", challengeId: "r4b", text: "Employer wellness budgets. We have one pilot letter.", evidence: [{ kind: "file", label: "docs/pilot.md" }] });
add("ruling", { round: "feasibility", challengeId: "r4b", votes: { ada: "upheld", rook: "partially_upheld", nova: "upheld" }, reason: "One letter of intent isn't a funding source yet." });
add("round_sealed", { round: "feasibility", scores: { a: [66, 70, 68], b: [70, 68, 72] } });

// ---- Round 5: Defense, with closing statements before it seals (BAT-06) ----
add("round_start", { round: "defense" });
add("question", { round: "defense", actor: "rook", text: "Which of your earlier claims are you least sure about, and why?" });
add("answer", { round: "defense", actor: "a", text: "The team mechanic. It works in tests, but we've only run it with one group of twelve people." });
add("answer", { round: "defense", actor: "b", text: "Fee revenue. The fee is designed but not deployed, so the cost numbers are estimates." });
add("challenge", { round: "defense", actor: "a", target: "b", challengeId: "r5a", move: "Fact Counter", text: "SplitPay repeated “live on mainnet” after the judges flagged it in round one.", evidence: [{ kind: "file", label: "transcript · round 1" }] });
add("rebuttal", { round: "defense", actor: "b", challengeId: "r5a", text: "We corrected it in round two. The deployment is testnet." });
add("ruling", { round: "defense", challengeId: "r5a", votes: { ada: "upheld", rook: "upheld", nova: "upheld" }, reason: "The claim was repeated after the correction." });
add("challenge", { round: "defense", actor: "b", target: "a", challengeId: "r5b", move: "Citation Check", text: "StepQuest cited rewards.spec.ts, but that file isn't in the snapshot." });
add("rebuttal", { round: "defense", actor: "a", challengeId: "r5b", text: "It's tests/rewards.spec.ts. We misquoted the path; the test exists.", evidence: [{ kind: "file", label: "tests/rewards.spec.ts:7" }] });
add("ruling", { round: "defense", challengeId: "r5b", votes: { ada: "rejected", rook: "rejected", nova: "rejected" }, reason: "The test exists at the corrected path." });
add("closing", { actor: "a", text: "We showed real users, verified data and honest limits. StepQuest is small, tested and ready for its first pilot." });
add("closing", { actor: "b", text: "SplitPay solves a real everyday pain. The fee isn't built yet, and we said so. The product works today." });
add("round_sealed", { round: "defense", scores: { a: [80, 77, 79], b: [71, 74, 70] } });

add("result", { winner: "a", reason: "score" });

const T0 = Date.parse("2026-11-06T13:10:00Z");
export const MOCK_EVENTS = S.map((e, i) => ({ seq: i + 1, ts: new Date(T0 + i * 11000).toISOString(), ...e }));
