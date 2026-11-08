/*
 * /organizer: grant roles, create tournaments, and watch or step in on running brackets.
 * Every rule is enforced by the contract; this page only makes the calls. PRD UI-12.
 * Every rule is enforced by the contract; this page only makes the calls. PRD UI-12.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { isAddress, keccak256, stringToHex } from "viem";
import { Button, Card, Chip, Input, StatusPill } from "@ds/ui.jsx";
import { chainNow, formatAmount, listTournaments, manager, read, readTournament, usePoll, useToken, useTx } from "../lib/chain.js";
import { bracketRounds, parseScore } from "../lib/pools.js";
import { MATCH_LABEL, PHASE_LABEL } from "../lib/labels.js";
import { api } from "../lib/api.js";
import { createEvent } from "../lib/events.js";
import { getBracket, getFight, runFight } from "../lib/arena.js";
import { usePayouts } from "../lib/payouts.js";
import { Link, navigate } from "../lib/router.jsx";
import { viewOfChain } from "../lib/tournamentView.js";
import { AddressLink, TxStatus, WalletGate } from "./ChainBits.jsx";
import { fadeUp, stagger } from "./fx.jsx";

const hash = (value) => keccak256(stringToHex(JSON.stringify(value)));
const MINUTE = 60n;

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
  const { data: server, refresh: refreshServer } = usePoll(() => api("/arena/auto").catch(() => null), [], 15000);
  const handOver = async () => {
    const calls = [!server.publisher && { ...manager, functionName: "grantRole", args: [data.publisherRole, server.address], label: "Let the server publish" }, !server.organizer && { ...manager, functionName: "grantRole", args: [data.organizerRole, server.address], label: "Let the server organize" }];
    if (await run(calls, "The server now runs tournaments by itself.")) await refreshServer();
  };

  // On-chain roles are the contract admin's job. Once the server has them, other admins never need this.
  if (data && !data.admin && server?.ready) return null;

  return (
    <Card className="stack">
      <h2 className="t-heading m0">1. Server access</h2>
      {data?.admin ? (
        <>
          <p className="t-body m0 muted">You're the contract admin. Bet from a different wallet: organizers and publishers can't bet in their own tournaments.</p>
          <div className="org-actions">
            {server?.address && !server.ready && (
              <Button variant="oracle" size="sm" disabled={busy || !data} onClick={handOver}>
                Let the server run tournaments
              </Button>
            )}
          </div>
          {server?.ready && <p className="t-caption m0">Tournaments run by themselves: after the deadline the server draws brackets, opens betting, runs fights, publishes results and pays out.</p>}
          <details>
            <summary className="t-caption">Grant a role to another wallet</summary>
            <div className="stack">
              <Input id="role-target" label="Wallet to grant (blank = this wallet)" placeholder={address} className="input t-mono" value={other} onChange={(e) => setOther(e.target.value)} error={other && !validTarget ? "That isn't a wallet address." : undefined} />
              <div className="org-actions">
                <Button variant="secondary" size="sm" disabled={busy || !validTarget} onClick={() => grant(data.organizerRole, target, "Organizer")}>
                  Grant organizer
                </Button>
                <Button variant="secondary" size="sm" disabled={busy || !validTarget} onClick={() => grant(data.publisherRole, target, "Publisher")}>
                  Grant publisher
                </Button>
              </div>
            </div>
          </details>
        </>
      ) : (
        <p className="t-body m0 muted">The server can't run tournaments yet. The wallet that deployed the contracts has to allow it once.</p>
      )}
      <TxStatus tx={tx} onDismiss={reset} />
    </Card>
  );
}

/** Creates a tournament: name, tracks and prizes, deadline, betting window, judges. The rest runs itself. */
function CreateEvent({ onCreated }) {
  const inHour = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [name, setName] = useState("");
  const [tracks, setTracks] = useState([{ name: "", prize: "" }]);
  const [deadline, setDeadline] = useState(inHour);
  const [minutes, setMinutes] = useState("10");
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: judges } = usePoll(() => api("/judges"), [], 0);
  const setTrack = (i, patch) => setTracks((all) => all.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const event = await createEvent({ name, tracks, deadline: new Date(deadline).toISOString(), bettingMinutes: Number(minutes), judgeIds: picked });
      onCreated?.();
      navigate(`/tournaments/${encodeURIComponent(event.id)}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Card className="stack">
      <h2 className="t-heading m0">2. Create a tournament</h2>
      <form className="stack" onSubmit={create}>
        <Input id="event-name" label="Tournament name" placeholder="ETH Global" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="stack stack--tight">
          <span className="t-label">Tracks and prizes</span>
          {tracks.map((t, i) => (
            <div key={i} className="grid2">
              <Input id={`track-${i}`} label={`Track ${i + 1}`} placeholder="Base" value={t.name} onChange={(e) => setTrack(i, { name: e.target.value })} />
              <Input id={`prize-${i}`} label="Prize" placeholder="$5,000" value={t.prize} onChange={(e) => setTrack(i, { prize: e.target.value })} />
            </div>
          ))}
          <div className="org-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => setTracks((all) => [...all, { name: "", prize: "" }])}>
              Add a track
            </Button>
          </div>
        </div>
        <div className="grid2">
          <Input id="event-deadline" label="Submissions close" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <Input id="event-minutes" label="Betting stays open on each match (minutes)" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
        <div className="field">
          <span className="t-label">Judges (pick 3)</span>
          <div className="trade__presets" role="group" aria-label="Judges">
            {(judges ?? []).map((j) => (
              <Chip key={j.id} selected={picked.includes(j.id)} onClick={() => toggle(j.id)}>
                {j.name}
              </Chip>
            ))}
          </div>
        </div>
        <p className="t-caption m0">Once submissions close and reviews finish, each track gets its own bracket and betting opens by itself. A fight takes about 8 minutes to judge and plays in 30 seconds when betting closes, so a betting window of 10 minutes means no wait. Results and payouts then run automatically.</p>
        {error && <p className="field__error" role="alert">{error}</p>}
        <Button type="submit" variant="oracle" disabled={saving}>
          {saving ? "Creating…" : "Create tournament"}
        </Button>
      </form>
    </Card>
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
  const payouts = usePayouts();
  const autoPublish = Boolean(payouts.address) && view.raw.publisher?.toLowerCase() === payouts.address.toLowerCase();
  const [fightError, setFightError] = useState("");
  const [starting, setStarting] = useState(false);
  const watching = match.opened && match.status === "live";
  const { data: fight, refresh: refreshFight } = usePoll(
    () => // A failed poll throws, so usePoll keeps the last answer instead of resetting the replay.
    (watching ? getFight(view.id, match.index) : Promise.resolve(null)),
    [watching, view.id, match.index],
    4000,
  );
  const fightRunning = fight?.status === "running" || starting;
  const startFight = async () => {
    setFightError("");
    setStarting(true);
    try {
      await runFight(view.id, match.index, { a: match.a, b: match.b, revealAt: Math.max(match.cutoffMs, view.cutoffMs), rerun: fight?.status === "failed" });
      await refreshFight();
    } catch (e) {
      setFightError(e.status === 403 || e.status === 401 ? "Sign in again as an organizer. " + e.message : e.message);
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

  const [serverBusy, setServerBusy] = useState(false);
  const askServer = async (action, body) => {
    setFightError("");
    setServerBusy(true);
    try {
      await api(`/arena/tournaments/${view.id}/matches/${match.index}/${action}`, { method: "POST", body });
    } catch (e) {
      setFightError(e.status === 403 || e.status === 401 ? "Sign in again as an organizer. " + e.message : e.message);
    } finally {
      setServerBusy(false);
    }
  };

  const open = async () => {
    if (autoPublish) return askServer("open", { minutes: Number(minutes) });
    let now;
    try {
      now = await chainNow();
    } catch {
      setFightError("Couldn't read the chain time. Try again.");
      return;
    }
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
          <Button variant="secondary" size="sm" disabled={busy || serverBusy} onClick={open}>
            {serverBusy ? "Opening…" : "Open match"}
          </Button>
          {fightError && <p className="field__error" role="alert">{fightError}</p>}
        </div>
      )}

      {match.status === "live" && (
        <div className="stack">
          <div className="stack stack--tight">
            <div className="org-actions">
              {(!payouts.enabled || fight?.status === "failed") && (
                <Button variant="secondary" size="sm" disabled={busy || fightRunning || fight?.status === "done" || fight?.status === "sealed"} onClick={startFight}>
                  {fightRunning ? "Fight running…" : fight?.status === "failed" ? "Run the fight again" : "Run the fight on 0G"}
                </Button>
              )}
              {payouts.enabled && fight?.status !== "failed" && fight?.status !== "done" && <span className="t-caption">{fightRunning ? "Fight running." : "The fight starts by itself in a few seconds."}</span>}
              {fight?.status === "done" && (
                <span className="t-body t-num">
                  {name(match.a)} {(fight.scores.a / 100).toFixed(2)} · {name(match.b)} {(fight.scores.b / 100).toFixed(2)}
                  {fight.tie.a || fight.tie.b ? ` · tie-break ${(fight.tie.a / 100).toFixed(2)} to ${(fight.tie.b / 100).toFixed(2)}` : ""}
                </span>
              )}
            </div>
            {fight?.status === "running" && <p className="t-caption m0">A UI face-off and 6 rounds on 0G ({fight.note ?? "starting"}). This takes a few minutes.</p>}
            {fight?.status === "failed" && <p className="field__error">The last run failed: {fight.error}</p>}
            {fight?.status === "done" && (
              <p className="t-caption m0">
                Judged by 3 judges over 6 rounds ({fight.calls} 0G calls). {autoPublish ? "The server is publishing the scores" : "Scores are filled in below"}{fight.needsReview ? "; both rounds tied, so the contract will send this to human review" : ""}.
              </p>
            )}
            {fightError && <p className="field__error" role="alert">{fightError}</p>}
          </div>
          {!autoPublish && <div className="org-scores">
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
          </div>}
          <div className="org-actions">
            {!autoPublish && (
              <Button variant="oracle" size="sm" disabled={busy || !scoresValid || !scores.a || !scores.b} onClick={publish}>
                Publish result
              </Button>
            )}
            <Button variant="danger" size="sm" disabled={busy || serverBusy} onClick={() => (autoPublish ? askServer("void") : run({ ...manager, functionName: "voidMatch", args: [id, index, hash({ reason: "organizer" })], label: "Void the match" }, "Match voided and tournament canceled."))}>
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
  const payouts = usePayouts();
  const serverRuns = Boolean(payouts.address) && tournament.organizer?.toLowerCase() === payouts.address.toLowerCase();
  const [cancelError, setCancelError] = useState("");
  const cancel = async () => {
    if (!serverRuns) return run({ ...manager, functionName: "cancelTournament", args: [BigInt(view.id), hash({ reason: "organizer" })], label: "Cancel the tournament" }, "Tournament canceled.");
    setCancelError("");
    try {
      await api(`/arena/tournaments/${view.id}/cancel`, { method: "POST" });
      await onChanged?.();
    } catch (e) {
      setCancelError(e.message);
    }
  };

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
        <p className="t-body m0 muted">The server is locking this bracket.</p>
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
          <Button variant="danger" size="sm" disabled={busy} onClick={cancel}>
            Cancel tournament
          </Button>
          {cancelError && <p className="field__error" role="alert">{cancelError}</p>}
        </details>
      )}
    </Card>
  );
}

export function OrganizerPage({ wallet }) {
  const info = useToken();
  const { data: list, refresh: refreshList, loading } = usePoll(listTournaments, [], 20000, { key: "chain:tournaments" });
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
        <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
          Organizers
        </h1>
        <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
          Create tournaments and watch them run. Everything after creating one is automatic.
        </p>
      </header>
      <WalletGate wallet={wallet} reason="to run a tournament" />
      {wallet.status === "connected" && wallet.onTargetNetwork && info && (
        <>
          <Roles wallet={wallet} onChanged={changed} />
          <CreateEvent onCreated={changed} />
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
