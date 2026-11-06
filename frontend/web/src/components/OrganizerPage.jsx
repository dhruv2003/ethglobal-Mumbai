/*
 * /organizer: run a real tournament on chain. Roles, create, pick real submitted projects and
 * freeze, open matches, run each fight on 0G, publish its scores, decide double ties, cancel.
 * Every rule is enforced by the contract; this page only makes the calls. PRD UI-12.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { isAddress, keccak256, stringToHex } from "viem";
import { Button, Card, Chip, Input, StatusPill } from "@ds/ui.jsx";
import { chainNow, formatAmount, listTournaments, manager, read, readTournament, toUnits, usePoll, useToken, useTx } from "../lib/chain.js";
import { bracketRounds, parseScore } from "../lib/pools.js";
import { MATCH_LABEL, PHASE_LABEL } from "../lib/labels.js";
import { api, organizerKey } from "../lib/api.js";
import { getBracket, matchmake, registerBracket, runFight } from "../lib/arena.js";
import { Link } from "../lib/router.jsx";
import { viewOfChain } from "../lib/tournamentView.js";
import { AddressLink, TxStatus, WalletGate } from "./ChainBits.jsx";
import { fadeUp, stagger } from "./fx.jsx";

const hash = (value) => keccak256(stringToHex(JSON.stringify(value)));
const MINUTE = 60n;
const DAY = 86400n;
const ROUNDS = { 2: 1n, 4: 2n, 8: 3n, 16: 4n };

/** The backend (bracket registration, running fights) takes the same organizer key as the judges page. */
function BackendKey() {
  const [key, setKey] = useState(organizerKey.get());
  return (
    <Card className="stack">
      <h2 className="t-heading m0">Backend key</h2>
      <div className="field">
        <label htmlFor="org-backend-key">Organizer key (ADMIN_TOKEN in backend/.env)</label>
        <input
          id="org-backend-key"
          className="input t-mono"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            organizerKey.set(e.target.value.trim());
          }}
        />
        <span className="field__help">Needed to save the bracket and to run fights. Kept in this tab only.</span>
      </div>
    </Card>
  );
}

function Roles({ wallet, onChanged }) {
  const address = wallet.address;
  const [other, setOther] = useState("");
  const { data, refresh } = usePoll(
    async () => {
      const [organizerRole, publisherRole, adminRole] = await Promise.all([read(manager, "ORGANIZER_ROLE"), read(manager, "PUBLISHER_ROLE"), read(manager, "DEFAULT_ADMIN_ROLE")]);
      const has = (role) => (address ? read(manager, "hasRole", [role, address]) : Promise.resolve(false));
      const [organizer, publisher, admin] = await Promise.all([has(organizerRole), has(publisherRole), has(adminRole)]);
      return { organizerRole, publisherRole, organizer, publisher, admin };
    },
    [address],
    15000,
  );
  const { tx, run, reset, busy } = useTx(wallet, async () => {
    await refresh();
    await onChanged?.();
  });
  const grant = (role, who, word) => run({ ...manager, functionName: "grantRole", args: [role, who], label: `Grant ${word}` }, `${word} role granted.`);
  const target = other.trim() || address;
  const validTarget = isAddress(target ?? "");

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="t-heading m0">1. Roles</h2>
        <span className="org-roles">
          <StatusPill tone={data?.organizer ? "success" : "neutral"}>{data?.organizer ? "You're an organizer" : "Not an organizer"}</StatusPill>
          <StatusPill tone={data?.publisher ? "success" : "neutral"}>{data?.publisher ? "You're a publisher" : "Not a publisher"}</StatusPill>
        </span>
      </div>
      {data?.admin ? (
        <>
          <p className="t-body m0 muted">You're the admin. Organizers and publishers can't bet in their own tournaments, so keep your betting wallets separate.</p>
          <Input id="role-target" label="Wallet to grant (blank = this wallet)" placeholder={address} className="input t-mono" value={other} onChange={(e) => setOther(e.target.value)} error={other && !validTarget ? "That isn't a wallet address." : undefined} />
          <div className="org-actions">
            <Button variant="secondary" size="sm" disabled={busy || !validTarget} onClick={() => grant(data.organizerRole, target, "Organizer")}>
              Grant organizer
            </Button>
            <Button variant="secondary" size="sm" disabled={busy || !validTarget} onClick={() => grant(data.publisherRole, target, "Publisher")}>
              Grant publisher
            </Button>
          </div>
        </>
      ) : (
        <p className="t-body m0 muted">{data?.organizer ? "You can run tournaments from this wallet." : "Only the admin can grant roles. Connect the wallet that deployed the contracts."}</p>
      )}
      <TxStatus tx={tx} onDismiss={reset} />
    </Card>
  );
}

function CreateTournament({ wallet, info, onCreated }) {
  const [capacity, setCapacity] = useState(4);
  const [cutoff, setCutoff] = useState("10");
  const [minBet, setMinBet] = useState("1");
  const [maxBet, setMaxBet] = useState("1000");
  const [reviewer, setReviewer] = useState("");
  const [recipient, setRecipient] = useState("");
  const { tx, run, reset, busy } = useTx(wallet, onCreated);
  const address = wallet.address;

  const minutes = Number(cutoff);
  const min = toUnits(minBet, info.decimals);
  const max = toUnits(maxBet, info.decimals);
  const reviewerAddress = reviewer.trim() || address;
  const recipientAddress = recipient.trim() || address;
  const valid = minutes >= 1 && min != null && max != null && min > 0n && min <= max && isAddress(reviewerAddress ?? "") && isAddress(recipientAddress ?? "");

  const create = async (e) => {
    e.preventDefault();
    if (!valid) return;
    const now = await chainNow();
    const bettingCutoff = now + BigInt(minutes) * MINUTE;
    const scheduledStart = bettingCutoff + MINUTE;
    // The contract requires (rounds + 1) x 24h; an hour's margin covers the wait for confirmation.
    const resolutionDeadline = scheduledStart + (ROUNDS[capacity] + 1n) * DAY + 60n * MINUTE;
    const config = {
      configHash: hash({ capacity, created: String(now), rubric: "40/20/20/10/10", split: "70/20/10" }),
      capacity,
      scheduledStart,
      bettingCutoff,
      resolutionDeadline,
      reviewer: reviewerAddress,
      publisher: address,
      platformRecipient: recipientAddress,
      minBet: min,
      maxBet: max,
    };
    await run({ ...manager, functionName: "createTournament", args: [config], label: "Create the tournament" }, "Tournament created. Freeze it next.");
  };

  return (
    <Card className="stack">
      <h2 className="t-heading m0">2. Create a tournament</h2>
      <form className="stack" onSubmit={create}>
        <div className="field">
          <span className="t-label">Projects</span>
          <div className="trade__presets">
            {[2, 4, 8, 16].map((c) => (
              <Chip key={c} selected={capacity === c} onClick={() => setCapacity(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid2">
          <Input id="org-cutoff" label="Tournament betting closes in (minutes)" inputMode="numeric" value={cutoff} onChange={(e) => setCutoff(e.target.value)} error={minutes >= 1 ? undefined : "At least 1 minute."} />
          <div className="grid2">
            <Input id="org-min" label={`Min bet (${info.symbol})`} inputMode="decimal" value={minBet} onChange={(e) => setMinBet(e.target.value)} />
            <Input id="org-max" label={`Max per wallet (${info.symbol})`} inputMode="decimal" value={maxBet} onChange={(e) => setMaxBet(e.target.value)} />
          </div>
        </div>
        <div className="grid2">
          <Input id="org-reviewer" label="Reviewer (blank = this wallet)" placeholder={address} value={reviewer} onChange={(e) => setReviewer(e.target.value)} error={reviewer && !isAddress(reviewer.trim()) ? "Not a wallet address." : undefined} />
          <Input id="org-platform" label="Platform 10% goes to (blank = this wallet)" placeholder={address} value={recipient} onChange={(e) => setRecipient(e.target.value)} error={recipient && !isAddress(recipient.trim()) ? "Not a wallet address." : undefined} />
        </div>
        {capacity === 2 && <p className="t-caption m0">A 2-project tournament (one final) needs the updated TournamentManager contract. On the older deployment, pick 4.</p>}
        <p className="t-caption m0">This wallet becomes the organizer and publisher, and can't bet in this tournament. A leftover tournament refunds by itself after its deadline.</p>
        <Button type="submit" variant="oracle" disabled={!valid || busy}>
          {busy ? "Working…" : "Create tournament"}
        </Button>
      </form>
      <TxStatus tx={tx} onDismiss={reset} />
    </Card>
  );
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** Pick real submitted projects, register the bracket with the backend, then freeze the same list on chain. */
function Freeze({ wallet, tournament, onDone }) {
  const [picked, setPicked] = useState([]);
  const [title, setTitle] = useState(`Tournament #${tournament.id}`);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [plan, setPlan] = useState(null); // the matchmaking result for exactly the projects picked
  const [matching, setMatching] = useState(false);
  const { tx, run, reset, busy } = useTx(wallet, onDone);
  const { data: subs, error: subsError } = usePoll(() => api("/submissions"), [], 8000);
  const allowed = [2, 4, 8, 16].filter((c) => c <= tournament.capacity);
  const byId = new Map((subs ?? []).map((x) => [x.id, x]));
  const ready = (x) => x.review?.status === "reviewed";
  const toggle = (id) => {
    setPlan(null); // any change to the field voids the proposed bracket
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const count = picked.length;
  const countOk = allowed.includes(count);
  const mine = picked.map((id) => byId.get(id)).filter(Boolean);
  const clash = mine.find((x) => [x.ownerWallet, x.rewardWallet ?? x.ownerWallet].some((w) => w?.toLowerCase() === wallet.address?.toLowerCase()));

  const authHint = (e) => (e.status === 403 || e.status === 401 ? "The backend needs the organizer key (Backend key box at the top). " + e.message : e.message);

  const autoMatch = async () => {
    setError("");
    setMatching(true);
    try {
      const seed = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
      const result = await matchmake({ submissionIds: picked, seed });
      setPlan({ ...result, field: [...picked] });
      setPicked(result.slots); // the bracket order the algorithm chose
    } catch (e) {
      setError(authHint(e));
    } finally {
      setMatching(false);
    }
  };

  const freeze = async () => {
    setError("");
    setWorking(true);
    try {
      await registerBracket(tournament.id, { title: title.trim() || `Tournament #${tournament.id}`, submissionIds: picked, proposal: plan?.resultHash });
    } catch (e) {
      setWorking(false);
      setError(authHint(e));
      return;
    }
    setWorking(false);
    const seed = plan?.seed ?? `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const projects = mine.map((x) => ({
      owner: x.ownerWallet,
      rewardWallet: x.rewardWallet ?? x.ownerWallet,
      snapshotHash: hash({ submissionId: x.id, repoUrl: x.repoUrl, name: x.project?.name, pitch: x.project?.pitch }),
    }));
    run({ ...manager, functionName: "freeze", args: [BigInt(tournament.id), projects, seed, plan ? `0x${plan.resultHash}` : hash({ order: picked, seed })], label: "Freeze the tournament" }, "Frozen. The tournament pool is open for bets.");
  };

  return (
    <div className="stack">
      <p className="t-body m0 muted">
        Pick the real projects that enter, then let matchmaking draw the bracket: the most similar projects meet in round one, and similar projects are kept in opposite halves so they meet as late as possible. Or tick them yourself in bracket order (1st and 2nd meet in match 1). Freezing locks the bracket and reward wallets and opens the tournament winner pool. It can't be undone.
      </p>
      <Input id="freeze-title" label="Tournament name" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="stack stack--tight" role="group" aria-label="Submitted projects">
        {subsError && !subs ? <p className="field__error">Couldn't reach the backend to list submissions.</p> : null}
        {subs && !subs.length ? <p className="t-body muted m0">No projects have been submitted yet. Submit one from the Submit page first.</p> : null}
        {(subs ?? []).map((x) => {
          const n = picked.indexOf(x.id);
          const ok = ready(x);
          return (
            <button key={x.id} type="button" className="org-pick" aria-pressed={n >= 0} disabled={!ok && n < 0} onClick={() => toggle(x.id)}>
              <span className="org-pick__n t-num">{n >= 0 ? n + 1 : ""}</span>
              <span className="stack stack--tight">
                <span className="t-body-strong">{x.project?.name}</span>
                <span className="t-caption">
                  {x.team?.name} · owner {short(x.ownerWallet)} · {ok ? "review done" : x.review?.status === "stopped" ? "review stopped" : "still being reviewed"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="org-actions">
        <Button variant="secondary" size="sm" disabled={!countOk || matching || !!clash} onClick={autoMatch}>
          {matching ? "Matching…" : plan ? "Match again" : "Match automatically"}
        </Button>
        {plan && <span className="t-caption">Bracket drawn by similarity matching. Hash {plan.resultHash.slice(0, 10)}… goes on chain.</span>}
        {!plan && countOk && <span className="t-caption">Manual order: recorded as chosen by the organizer.</span>}
      </div>
      {plan && (
        <ol className="stack stack--tight t-caption">
          {plan.explain.map((m) => (
            <li key={m.match}>
              <b>{m.aName}</b> vs <b>{m.bName}</b>
              {m.similarityPct != null ? ` · ${m.similarityPct}% similar (story ${Math.round(m.parts.cosine / 100)}%, tracks ${Math.round(m.parts.tracks / 100)}%, tech ${Math.round(m.parts.tech / 100)}%)` : " · the only possible fight"}
            </li>
          ))}
        </ol>
      )}
      {clash && <p className="field__error">{clash.project?.name} is owned by this wallet. The organizer can't also be a project owner; use another wallet.</p>}
      <p className="t-caption m0">
        {count} picked. {countOk ? "Ready to freeze." : `Pick ${allowed.join(", ")} projects (this tournament holds up to ${tournament.capacity}).`} Owners and reward wallets can't bet in this tournament, so bet from a different wallet.
      </p>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Button variant="oracle" disabled={busy || working || !countOk || !!clash} onClick={freeze}>
        {working ? "Saving the bracket…" : busy ? "Working…" : `Freeze with ${count || "…"} projects`}
      </Button>
      <TxStatus tx={tx} onDismiss={reset} />
    </div>
  );
}

function MatchRow({ wallet, view, match, busy, run }) {
  const id = BigInt(view.id);
  const index = BigInt(match.index);
  const [minutes, setMinutes] = useState("2");
  const [scores, setScores] = useState({ a: "", b: "", tieA: "", tieB: "" });
  const [why, setWhy] = useState("");
  const name = (p) => (p == null ? "To be decided" : view.projects[p].name);
  const label = MATCH_LABEL[match.status];
  const [fightError, setFightError] = useState("");
  const [starting, setStarting] = useState(false);
  const watching = match.opened && match.status === "live";
  const { data: fight, refresh: refreshFight } = usePoll(
    () => (watching ? api(`/arena/fights/${view.id}/${match.index}/result`, { method: "POST" }).catch(() => null) : Promise.resolve(null)),
    [watching, view.id, match.index],
    4000,
  );
  const fightRunning = fight?.status === "running" || starting;
  const startFight = async () => {
    setFightError("");
    setStarting(true);
    try {
      await runFight(view.id, match.index, { a: match.a, b: match.b, revealAt: match.cutoffMs, rerun: fight?.status === "failed" });
      await refreshFight();
    } catch (e) {
      setFightError(e.status === 403 || e.status === 401 ? "The backend needs the organizer key (Backend key box at the top). " + e.message : e.message);
    } finally {
      setStarting(false);
    }
  };
  const fill = (f) => setScores({ a: (f.scores.a / 100).toFixed(2), b: (f.scores.b / 100).toFixed(2), tieA: f.tie.a ? (f.tie.a / 100).toFixed(2) : "", tieB: f.tie.b ? (f.tie.b / 100).toFixed(2) : "" });
  useEffect(() => {
    if (fight?.status === "done" && !scores.a && !scores.b) fill(fight);
  }, [fight?.status]);

  const parsed = { a: parseScore(scores.a), b: parseScore(scores.b), tieA: parseScore(scores.tieA || "0"), tieB: parseScore(scores.tieB || "0") };
  const scoresValid = Object.values(parsed).every((v) => v != null);
  const tied = scoresValid && parsed.a === parsed.b;

  const open = async () => {
    const now = await chainNow();
    const cutoff = now + BigInt(Math.max(1, Number(minutes) || 1)) * MINUTE;
    const scheduled = BigInt(Math.floor(new Date(view.startsAt).getTime() / 1000));
    const start = cutoff > scheduled ? cutoff : scheduled;
    run({ ...manager, functionName: "openMatch", args: [id, index, cutoff, start], label: `Open match ${match.index + 1}` }, `Match ${match.index + 1} is open for bets.`);
  };

  const publish = () =>
    run(
      { ...manager, functionName: "publishResult", args: [id, index, parsed.a, parsed.b, parsed.tieA, parsed.tieB, fight?.status === "done" && fight.resultHash ? fight.resultHash : hash({ match: match.index, ...parsed })], label: "Publish the scores" },
      tied && parsed.tieA === parsed.tieB ? "Tied twice. The match is waiting for the reviewer." : "Result published.",
    );

  const decide = (project) =>
    run({ ...manager, functionName: "resolveHumanReview", args: [id, index, project, hash({ why })], label: "Record the decision" }, "Decision recorded.");

  const waiting = match.opened && Date.now() < Math.max(match.cutoffMs, view.cutoffMs);
  const canOpen = !match.opened && match.a != null && match.b != null && view.phase !== "canceled";

  return (
    <motion.li className="org-match" variants={fadeUp} layout>
      <div className="org-match__head">
        <div className="stack stack--tight">
          <span className="t-caption">
            Match {match.index + 1} · {match.roundName}
          </span>
          <span className="t-body-strong">
            {name(match.a)} <span className="muted">vs</span> {name(match.b)}
          </span>
        </div>
        <span className="org-actions">
          <StatusPill tone={label.tone}>{label.word}</StatusPill>
          {match.opened && (
            <Link className="btn btn--ghost btn--sm" to={`/fights/${view.id}/${match.index}`}>
              Open fight
            </Link>
          )}
        </span>
      </div>

      {canOpen && (
        <div className="org-match__form">
          <Input id={`open-${match.index}`} label="Betting closes in (minutes)" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <Button variant="secondary" size="sm" disabled={busy} onClick={open}>
            Open match
          </Button>
        </div>
      )}

      {match.status === "live" && (
        <div className="stack">
          <div className="stack stack--tight">
            <div className="org-actions">
              <Button variant="secondary" size="sm" disabled={busy || fightRunning || fight?.status === "done" || fight?.status === "sealed"} onClick={startFight}>
                {fightRunning ? "Fight running…" : fight?.status === "failed" ? "Run the fight again" : "Run the fight on 0G"}
              </Button>
              {fight?.status === "done" && (
                <span className="t-body t-num">
                  {name(match.a)} {(fight.scores.a / 100).toFixed(2)} · {name(match.b)} {(fight.scores.b / 100).toFixed(2)}
                  {fight.tie.a || fight.tie.b ? ` · tie-break ${(fight.tie.a / 100).toFixed(2)} to ${(fight.tie.b / 100).toFixed(2)}` : ""}
                </span>
              )}
            </div>
            {fight?.status === "running" && <p className="t-caption m0">5 rounds on 0G ({fight.note ?? "starting"}). This takes a few minutes.</p>}
            {fight?.status === "failed" && <p className="field__error">The last run failed: {fight.error}</p>}
            {fight?.status === "done" && (
              <p className="t-caption m0">
                Judged by 3 judges over 5 rounds ({fight.calls} 0G calls). Scores are filled in below{fight.needsReview ? "; both rounds tied, so the contract will send this to human review" : ""}. Publishing sends them to the contract.
              </p>
            )}
            {fightError && <p className="field__error" role="alert">{fightError}</p>}
          </div>
          <div className="org-scores">
            <Input id={`a-${match.index}`} label={`${name(match.a)} score`} inputMode="decimal" placeholder="82.50" value={scores.a} onChange={(e) => setScores({ ...scores, a: e.target.value })} />
            <Input id={`b-${match.index}`} label={`${name(match.b)} score`} inputMode="decimal" placeholder="78.00" value={scores.b} onChange={(e) => setScores({ ...scores, b: e.target.value })} />
            <AnimatePresence initial={false}>
              {tied && (
                <motion.div className="org-scores__tie" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Input id={`ta-${match.index}`} label={`${name(match.a)} tie-break`} inputMode="decimal" value={scores.tieA} onChange={(e) => setScores({ ...scores, tieA: e.target.value })} />
                  <Input id={`tb-${match.index}`} label={`${name(match.b)} tie-break`} inputMode="decimal" value={scores.tieB} onChange={(e) => setScores({ ...scores, tieB: e.target.value })} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="org-actions">
            <Button variant="oracle" size="sm" disabled={busy || !scoresValid || !scores.a || !scores.b} onClick={publish}>
              Publish result
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => run({ ...manager, functionName: "voidMatch", args: [id, index, hash({ reason: "organizer" })], label: "Void the match" }, "Match voided and tournament canceled.")}>
              Void match
            </Button>
          </div>
          {waiting && <p className="t-caption m0">Betting is still open, so publishing will be refused until the cutoff.</p>}
        </div>
      )}

      {match.status === "review" && (
        <div className="stack">
          <p className="t-body m0">Tied twice. Only the reviewer can decide, and the reason is recorded.</p>
          <Input id={`why-${match.index}`} label="Reason for the decision" value={why} onChange={(e) => setWhy(e.target.value)} />
          <div className="org-actions">
            {[match.a, match.b].map((p) => (
              <Button key={p} variant="secondary" size="sm" disabled={busy || !why.trim()} onClick={() => decide(p)}>
                {name(p)} wins
              </Button>
            ))}
          </div>
        </div>
      )}

      {match.status === "finalized" && (
        <p className="t-body m0 t-num">
          <b>{name(match.winner)} won</b> · {(match.scoreA / 100).toFixed(2)} to {(match.scoreB / 100).toFixed(2)}
          {match.winWord ? ` · ${match.winWord}` : ""}
        </p>
      )}
    </motion.li>
  );
}

function TournamentControl({ wallet, tournament, onChanged }) {
  const { data: meta } = usePoll(() => getBracket(tournament.id), [tournament.id], 6000);
  const view = viewOfChain(tournament, meta);
  const { tx, run, reset, busy } = useTx(wallet, onChanged);
  const label = PHASE_LABEL[view.phase];
  const finished = view.phase === "completed" || view.phase === "canceled";

  const roundBlocks = bracketRounds(view.count);

  return (
    <Card className="stack">
      <div className="section-head">
        <h2 className="t-heading m0">3. Run {view.title}</h2>
        <StatusPill tone={label.tone}>{label.word}</StatusPill>
      </div>
      <div className="org-facts t-caption">
        <span>Reviewer: <AddressLink address={tournament.reviewer} /></span>
        <span>Publisher: <AddressLink address={tournament.publisher} /></span>
        <span className="t-num">Betting closes {new Date(view.cutoffMs).toLocaleString()}</span>
        <Link className="link" to={`/tournaments/${view.id}`}>Open tournament page</Link>
      </div>

      {!view.frozen && tournament.status === 1 ? (
        <Freeze wallet={wallet} tournament={tournament} onDone={onChanged} />
      ) : view.frozen ? (
        roundBlocks.map((round) => (
          <div key={round.round} className="stack">
            <h3 className="t-label m0">{round.name}</h3>
            <motion.ol className="org-matches" variants={stagger(0.05)} initial="hidden" animate="show">
              {round.matches.map((i) => (
                <MatchRow key={i} wallet={wallet} view={view} match={view.matches[i]} busy={busy} run={run} />
              ))}
            </motion.ol>
          </div>
        ))
      ) : null}

      <TxStatus tx={tx} onDismiss={reset} />

      {!finished && (
        <details className="org-danger">
          <summary className="t-body-strong">Cancel this tournament</summary>
          <p className="t-body muted">Unresolved pools refund, future matches stop, and finalized matches stay as they are. This can't be undone.</p>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => run({ ...manager, functionName: "cancelTournament", args: [BigInt(view.id), hash({ reason: "organizer" })], label: "Cancel the tournament" }, "Tournament canceled.")}>
            Cancel tournament
          </Button>
        </details>
      )}
    </Card>
  );
}

export function OrganizerPage({ wallet }) {
  const info = useToken();
  const { data: list, refresh: refreshList, loading } = usePoll(listTournaments, [], 20000);
  const [selected, setSelected] = useState(null);
  const current = selected ?? list?.[0]?.id ?? null;
  const { data: tournament, refresh } = usePoll(() => (current ? readTournament(current) : Promise.resolve(null)), [current], 10000);
  const changed = async () => {
    await Promise.all([refreshList(), refresh()]);
  };

  // A newly created tournament becomes the selected one.
  useEffect(() => {
    setSelected(null);
  }, [list?.length]);

  return (
    <div className="stack stack--page">
      <header className="intro">
        <span className="eyebrow rise">Backstage</span>
        <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
          Organizer <span className="hl hl--crush">console</span>
        </h1>
        <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
          Runs a real tournament on chain: pick submitted projects, open each match, run the fight on 0G, publish the scores.
        </p>
      </header>
      <WalletGate wallet={wallet} reason="to run a tournament" />
      {wallet.status === "connected" && wallet.onTargetNetwork && info && (
        <>
          <BackendKey />
          <Roles wallet={wallet} onChanged={changed} />
          <CreateTournament wallet={wallet} info={info} onCreated={changed} />
          {list?.length ? (
            <div className="trade__presets" role="group" aria-label="Choose a tournament">
              {list.map((t) => (
                <Chip key={t.id} selected={current === t.id} onClick={() => setSelected(t.id)}>
                  #{t.id} · {t.count} projects
                </Chip>
              ))}
            </div>
          ) : !loading ? (
            <p className="t-body muted m0">No tournaments on chain yet. Create the first one above.</p>
          ) : null}
          {tournament && <TournamentControl key={tournament.id} wallet={wallet} tournament={tournament} onChanged={changed} />}
          <p className="t-caption m0 t-num">Bets accepted in {info.symbol} ({formatAmount(10n ** BigInt(info.decimals), info.decimals)} = one whole token).</p>
        </>
      )}
    </div>
  );
}
