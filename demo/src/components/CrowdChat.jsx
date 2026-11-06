/*
 * The crowd, live: people in the room talking over the fight, and every bet as it lands.
 * Demo: the lines are scripted per fight and arrive on a loose rhythm; bets come from the
 * same sim the odds use, so the chat and the donut always agree. You can say something too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PixelFighter } from "./PixelFighter.jsx";
import { recentBets } from "../lib/demo/sim.js";

// [who, line]. {A} and {B} are the two fighters.
const HEADLINE = [
  ["rohan.eth", "{B}'s demo video had better production than my wedding"],
  ["neha.eth", "ok but does it work on a phone tho"],
  ["degen-dosa", "Priya is about to ask about mobile, I can feel it"],
  ["sid_onchain", "settle() being a view function is the funniest thing I've read all week 💀"],
  ["kaju.eth", "48 of 48 checks on Windows, Android AND iPhone. for a hackathon build??"],
  ["juhu-whale", "all in on {B}. vibes > evidence"],
  ["mehta.base", "bro bet against the evidence. bold."],
  ["bandra-bull", "Marcus is about to open contest.sol line 60 and ruin someone's day"],
  ["tiffin.eth", "who's watching from the chai stall 🙋"],
  ["priyadarshini", "I staked 1 USDC on my own sleep on {A} last night. woke up at 6. got paid."],
  ["0xKaran", "{B}'s video editor deserves a prize honestly"],
  ["powai-punter", "the stake tx escrowed 0 ETH. ZERO. 😭"],
  ["ana-fan", "Ana: 'who pays for this?' every single round 😂"],
  ["colaba-capital", "odds moving, someone just dropped 220 on {B}"],
  ["vada-pav-dao", "if {B} wins I'm deleting my github"],
  ["matunga-moon", "the rep counter is real though, it counted my squats"],
  ["worli-wagers", "judges citing file:line numbers is the most honest thing at this event"],
  ["andheri-ape", "85% of the pool on {B}... we're about to learn something"],
  ["ghatkopar", "GG in advance {A}"],
  ["dadar-degen", "imagine losing a fight to your own contest.sol"],
];
const GENERIC = [
  ["rohan.eth", "{A} vs {B}, finally"],
  ["neha.eth", "does either of them work on a phone"],
  ["degen-dosa", "the judges are going to cite line numbers, aren't they"],
  ["kaju.eth", "pool's getting spicy"],
  ["juhu-whale", "backing {B}, don't @ me"],
  ["bandra-bull", "Marcus reads contracts for breakfast"],
  ["tiffin.eth", "chai break? no. FIGHT"],
  ["mehta.base", "{A} has the better demo, {B} has the better code. pick one"],
  ["ana-fan", "Ana will ask who pays. she always asks who pays"],
  ["sid_onchain", "this is better than the closing ceremony"],
  ["worli-wagers", "evidence > vibes, every time"],
  ["ghatkopar", "GG either way, both teams shipped"],
];
const COLORS = ["#e8457f", "#2f4bf0", "#c98500", "#0e7c66", "#6f4cff", "#f08c00", "#1c7ed6", "#a61e4d", "#5c940d"];
const colorOf = (s) => COLORS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];
const BADGE = { "juhu-whale": "🐋", "colaba-capital": "🐋", "ana-fan": "⭐" };

export function CrowdChat({ matchIndex, a, b, symbol = "", dark = false }) {
  const script = useMemo(() => (matchIndex === 0 ? HEADLINE : GENERIC).map(([who, t], i) => ({ id: `s${i}`, who, text: t.replaceAll("{A}", a.name).replaceAll("{B}", b.name) })), [matchIndex, a.name, b.name]);
  const [n, setN] = useState(5); // the room was already talking
  const [mine, setMine] = useState([]);
  const [text, setText] = useState("");
  const [, tick] = useState(0);
  const list = useRef(null);
  const stick = useRef(true);

  useEffect(() => {
    let t;
    const next = () => {
      t = setTimeout(() => {
        setN((k) => k + 1);
        next();
      }, 2200 + Math.random() * 2400);
    };
    next();
    const bets = setInterval(() => tick((k) => k + 1), 2000);
    return () => {
      clearTimeout(t);
      clearInterval(bets);
    };
  }, []);

  // Lines (looping the script), bets and your messages, in time order.
  const items = useMemo(() => {
    const t0 = Date.now() - n * 3000;
    const lines = Array.from({ length: n }, (_, i) => ({ ...script[i % script.length], id: `l${i}`, time: t0 + i * 3000 }));
    const bets = recentBets(matchIndex)
      .slice(0, 6)
      .map((x) => ({ id: x.txHash, bet: true, who: x.mine ? "You" : x.bettor, side: x.side, amount: x.amount, time: x.time, mine: x.mine }));
    return [...lines, ...bets, ...mine].sort((x, y) => x.time - y.time).slice(-40);
  }, [n, script, matchIndex, mine]);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  const send = (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setMine((m) => [...m, { id: `me${Date.now()}`, who: "You", text: t, time: Date.now(), me: true }]);
    setText("");
    stick.current = true;
  };
  const watching = 180 + n * 3;

  return (
    <section className={`chat ${dark ? "chat--dark" : ""}`} aria-label="Live chat">
      <header className="chat__head">
        <b>Live chat</b>
        <span className="chat__count t-num">
          <i aria-hidden="true" /> {watching} watching
        </span>
      </header>
      <ol
        className="chat__list m0"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <AnimatePresence initial={false}>
          {items.map((m) =>
            m.bet ? (
              <motion.li key={m.id} className={`chat__bet chat__bet--${m.side} ${m.mine ? "is-mine" : ""}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
                <span aria-hidden="true">🪙</span> <b>{m.who}</b> backed <b>{m.side === "a" ? a.name : b.name}</b>
                <span className="chat__amt t-num">
                  {Number(m.amount).toLocaleString()} {symbol}
                </span>
              </motion.li>
            ) : (
              <motion.li key={m.id} className={`chat__msg ${m.me ? "is-me" : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 32 }}>
                <span className="chat__face" aria-hidden="true">
                  <PixelFighter project={{ seed: m.who, name: m.who, tracks: [] }} scale={1} label="" />
                </span>
                <span className="chat__body">
                  <b style={{ color: m.me ? undefined : colorOf(m.who) }}>
                    {m.who}
                    {BADGE[m.who] && <span className="chat__badge"> {BADGE[m.who]}</span>}
                  </b>{" "}
                  {m.text}
                </span>
              </motion.li>
            ),
          )}
        </AnimatePresence>
      </ol>
      <form className="chat__form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={140} aria-label="Chat message" />
        <button type="submit" disabled={!text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </section>
  );
}
