/*
 * Live chat beside the fight: every real bet on this match as it lands (read from the
 * BettingPools contract), plus what you type. There's no chat server yet, so your
 * messages are only shown on your screen; nothing here is scripted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PixelFighter } from "./PixelFighter.jsx";
import { useRecentBets } from "../lib/bets.js";

const COLORS = ["#e8457f", "#2f4bf0", "#c98500", "#0e7c66", "#6f4cff", "#f08c00", "#1c7ed6", "#a61e4d", "#5c940d"];
const colorOf = (s) => COLORS[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

export function CrowdChat({ tournament, match, a, b, symbol = "", dark = false }) {
  const [mine, setMine] = useState([]);
  const [text, setText] = useState("");
  const list = useRef(null);
  const stick = useRef(true);
  const real = useRecentBets(tournament, match);

  // Real bets and your messages, in time order.
  const items = useMemo(() => {
    const bets = real.slice(0, 20).map((x) => ({ id: x.txHash, bet: true, who: x.mine ? "You" : x.bettor, side: x.side, amount: x.amount, time: x.time, mine: x.mine }));
    return [...bets, ...mine].sort((x, y) => x.time - y.time).slice(-40);
  }, [real, mine]);

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

  return (
    <section className={`chat ${dark ? "chat--dark" : ""}`} aria-label="Live chat">
      <header className="chat__head">
        <b>Live chat</b>
        <span className="chat__count t-num">
          <i aria-hidden="true" /> {real.length} recent {real.length === 1 ? "bet" : "bets"}
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
        {!items.length && <li className="chat__empty t-caption">{tournament?.preview ? "Bets show up here live once betting opens." : "No bets in the last two hours. New ones show up here the moment they're placed."}</li>}
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
                  </b>{" "}
                  {m.text}
                </span>
              </motion.li>
            ),
          )}
        </AnimatePresence>
      </ol>
      <form className="chat__form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something (only you see it)…" maxLength={140} aria-label="Chat message" />
        <button type="submit" disabled={!text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </section>
  );
}
