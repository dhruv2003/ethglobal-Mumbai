import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, Easing } from "remotion";
import { C, Paper, Headline, Card, Sticker, Fighter, Kickoff, display, mono, body, pop, shake, useSpring, lerp, clamp, Cursor } from "../theme.jsx";
import { FIGHTER_A, FIGHTER_B } from "../cast.js";

const CHAT = [
  { at: 8, who: "0xriya", msg: "ZK VOTE all in 🔥", side: "a" },
  { at: 22, who: "degen.eth", msg: "memepay comeback??", side: "b" },
  { at: 36, who: "0xkabir", msg: "that live demo was clean", side: "a" },
  { at: 52, who: "anon", msg: "judges cooking today", side: "b" },
  { at: 70, who: "neha.eth", msg: "+9 architecture lol", side: "a" },
];

/* 0:50–0:56 — bet on the fight, watch the pool, collect. */
export const Bet = () => {
  const frame = useCurrentFrame();
  const pickAt = 24, placeAt = 46, winAt = 92;
  const picked = frame >= pickAt;
  const placed = frame >= placeAt;
  const poolA = Math.round(lerp(frame, 0, 90, 9200, 14800));
  const poolB = Math.round(lerp(frame, 0, 90, 7900, 9100));
  const share = poolA / (poolA + poolB);
  const oddsA = ((poolA + poolB) / poolA).toFixed(2);
  const oddsB = ((poolA + poolB) / poolB).toFixed(2);
  const win = useSpring(winAt, { damping: 11, stiffness: 180, mass: 0.6 });
  const payout = Math.round(lerp(frame, winAt + 6, winAt + 34, 0, 94, Easing.out(Easing.cubic)));
  const sh = shake(frame, winAt, 16, 8);
  const cur = frame < pickAt ? { x: lerp(frame, 0, pickAt - 2, 1500, 1170), y: lerp(frame, 0, pickAt - 2, 980, 560), tap: null } : frame < placeAt ? { x: lerp(frame, pickAt + 6, placeAt - 2, 1170, 1420), y: lerp(frame, pickAt + 6, placeAt - 2, 560, 830), tap: pickAt } : { x: 1420, y: 830, tap: placeAt };

  return (
    <Paper>
      <AbsoluteFill style={{ transform: `translate(${sh.x}px,${sh.y}px)` }}>
        <div style={{ position: "absolute", top: 50, left: 90 }}>
          <Headline words={["Watch.", "Bet.", "Win."]} size={104} highlight={{ 1: C.sunny }} />
        </div>

        {/* left: live ring + crowd chat */}
        <div style={{ position: "absolute", left: 90, top: 210, width: 860 }}>
          <Card style={{ height: 480, position: "relative", overflow: "hidden", background: C.oracleSoft }} shadow={10}>
            <div style={{ position: "absolute", left: 20, top: 18, background: C.crush, color: C.white, fontFamily: mono, fontSize: 20, padding: "4px 12px", borderRadius: 8, border: `3px solid ${C.ink}`, opacity: frame % 24 < 16 ? 1 : 0.6 }}>● LIVE</div>
            <div style={{ position: "absolute", left: 90, right: 90, bottom: 40, height: 70, background: C.sunny, border: `4px solid ${C.ink}`, borderRadius: 18, transform: "perspective(600px) rotateX(40deg)" }} />
            <div style={{ position: "absolute", left: 120, top: 80 }}>
              <Fighter project={FIGHTER_A} pose={frame % 30 < 8 ? "punch" : frame % 20 < 10 ? "idle" : "bob"} scale={14} />
            </div>
            <div style={{ position: "absolute", left: 430, top: 80 }}>
              <Fighter project={FIGHTER_B} pose={frame % 30 < 8 ? "hit" : frame % 20 < 10 ? "idle" : "block"} scale={14} flip />
            </div>
          </Card>
          <div style={{ position: "relative", height: 300, marginTop: 20, overflow: "hidden" }}>
            {CHAT.map((c, i) => {
              const d = frame - c.at;
              if (d < 0) return null;
              const later = CHAT.filter((o) => o.at > c.at && frame >= o.at).length;
              return (
                <div key={i} style={{ position: "absolute", left: c.side === "a" ? 0 : 300, bottom: 10 + later * 62, opacity: interpolate(d, [0, 5], [0, 1], clamp), transform: `translateY(${interpolate(d, [0, 6], [40, 0], clamp)}px)` }}>
                  <span style={{ fontFamily: body, fontWeight: 600, fontSize: 26, background: c.side === "a" ? C.oracleSoft : C.crushSoft, border: `3px solid ${C.ink}`, borderRadius: 999, padding: "8px 18px", whiteSpace: "nowrap" }}>
                    <b style={{ fontFamily: mono, fontSize: 20, color: c.side === "a" ? C.oracle : C.crushInk }}>{c.who}</b> {c.msg}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* right: bet panel */}
        <div style={{ position: "absolute", left: 1010, top: 210, width: 820 }}>
          <Card style={{ padding: 40, height: 770, boxSizing: "border-box" }} shadow={12}>
            <div style={{ fontFamily: mono, fontSize: 20, color: "#5b5566" }}>MATCH POOL · Base Sepolia</div>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 52, letterSpacing: "-0.02em", margin: "6px 0 22px" }}>Who wins?</div>
            <div style={{ display: "flex", gap: 20 }}>
              <Side name="ZK Vote" odds={oddsA} color={C.oracle} soft={C.oracleSoft} active={picked} />
              <Side name="MemePay" odds={oddsB} color={C.crush} soft={C.crushSoft} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 30, marginTop: 34 }}>
              <Donut share={share} />
              <div>
                <div style={{ fontFamily: mono, fontSize: 20, color: "#5b5566" }}>TOTAL POOL</div>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 64, letterSpacing: "-0.02em" }}>{(poolA + poolB).toLocaleString()}</div>
                <div style={{ fontFamily: body, fontWeight: 700, fontSize: 24 }}>
                  <span style={{ color: C.oracle }}>■ {Math.round(share * 100)}%</span>  <span style={{ color: C.crushInk }}>■ {100 - Math.round(share * 100)}%</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 36, display: "flex", gap: 20, alignItems: "center" }}>
              <div style={{ flex: 1, fontFamily: mono, fontSize: 30, border: `3px solid ${C.ink}`, borderRadius: 14, padding: "16px 20px", background: C.paper }}>{picked ? "50 tFC" : "0 tFC"}</div>
              <div style={{ background: placed ? C.mint : C.ink, color: C.white, fontFamily: display, fontWeight: 800, fontSize: 36, padding: "16px 30px", borderRadius: 14, border: `3px solid ${C.ink}`, boxShadow: frame >= placeAt && frame < placeAt + 5 ? "none" : pop(6), transform: frame >= placeAt && frame < placeAt + 5 ? "translate(4px,4px)" : "none" }}>
                {placed ? "Bet placed ✓" : "Place bet"}
              </div>
            </div>
          </Card>
        </div>
        <Cursor x={cur.x} y={cur.y} tap={cur.tap} color={C.sunny} label="you" />

        {/* win overlay */}
        {frame >= winAt && (
          <AbsoluteFill style={{ background: `rgba(23,20,31,${interpolate(win, [0, 1], [0, 0.55])})`, justifyContent: "center", alignItems: "center" }}>
            <div style={{ transform: `scale(${interpolate(win, [0, 1], [0.4, 1])}) rotate(-3deg)` }}>
              <Card bg={C.sunny} shadow={16} style={{ padding: "40px 70px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 26 }}>ZK VOTE WON · PAYOUT</div>
                <Kickoff size={200}>+{payout} tFC</Kickoff>
                <Podium />
              </Card>
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    </Paper>
  );
};

const Side = ({ name, odds, color, soft, active }) => (
  <div style={{ flex: 1, border: `3px solid ${C.ink}`, borderRadius: 16, padding: "18px 22px", background: active ? color : soft, color: active ? C.white : C.ink, boxShadow: active ? pop(2) : pop(6), transform: active ? "translate(4px,4px)" : "none" }}>
    <div style={{ fontFamily: display, fontWeight: 800, fontSize: 38 }}>{name}</div>
    <div style={{ fontFamily: mono, fontSize: 26 }}>{odds}×</div>
  </div>
);

const Donut = ({ share }) => {
  const r = 80, c = 2 * Math.PI * r;
  return (
    <svg width="210" height="210" viewBox="-105 -105 210 210">
      <circle r={r} fill="none" stroke={C.crush} strokeWidth="34" />
      <circle r={r} fill="none" stroke={C.oracle} strokeWidth="34" strokeDasharray={`${share * c} ${c}`} transform="rotate(-90)" />
      <circle r={r + 19} fill="none" stroke={C.ink} strokeWidth="4" />
      <circle r={r - 19} fill="none" stroke={C.ink} strokeWidth="4" />
    </svg>
  );
};

const Podium = () => {
  const frame = useCurrentFrame();
  const rise = (k) => lerp(frame, 104 + k * 5, 118 + k * 5, 0, 1, Easing.out(Easing.back(1.6)));
  const spots = [
    { h: 90, label: "2", who: "MemePay", col: C.crushSoft, k: 1 },
    { h: 140, label: "1", who: "ZK Vote", col: C.oracle, k: 0 },
    { h: 60, label: "3", who: "ChainChef", col: C.sunken, k: 2 },
  ];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, height: 190, marginTop: 10 }}>
      {spots.map((s) => (
        <div key={s.label} style={{ width: 170, textAlign: "center" }}>
          <div style={{ fontFamily: body, fontWeight: 700, fontSize: 22, opacity: rise(s.k) }}>{s.who}</div>
          <div style={{ height: s.h * rise(s.k), background: s.col, border: `3px solid ${C.ink}`, borderRadius: "12px 12px 0 0", fontFamily: display, fontWeight: 800, fontSize: 40, color: s.k === 0 ? C.white : C.ink, overflow: "hidden" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
};

/* 0:56–1:00 — bracket, proof stickers, logo. */
export const Close = () => {
  const frame = useCurrentFrame();
  const zoom = lerp(frame, 0, 40, 1.5, 1, Easing.out(Easing.cubic));
  const logoAt = 62;
  const logo = useSpring(logoAt, { damping: 10, stiffness: 220, mass: 0.6 });
  const sh = shake(frame, logoAt + 2, 20, 10);
  if (frame >= logoAt) {
    return (
      <Paper color={C.sunny} dot="rgba(23,20,31,0.1)">
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `translate(${sh.x}px,${sh.y}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40, transform: `scale(${interpolate(logo, [0, 1], [2.6, 1], clamp)})` }}>
            <Img src={staticFile("logo.svg")} style={{ width: 220, height: 220, borderRadius: 48, border: `5px solid ${C.ink}`, boxShadow: pop(12) }} />
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 170, letterSpacing: "-0.05em", lineHeight: 0.85 }}>
              Fight<span style={{ color: C.crushInk }}>Club</span>
            </div>
          </div>
          <div style={{ marginTop: 50 }}>
            <Headline words={["Judge", "everything.", "Make", "it", "a", "show."]} at={logoAt + 10} size={70} stagger={3} highlight={{ 5: C.white }} />
          </div>
          <div style={{ marginTop: 30 }}>
            <Sticker at={logoAt + 28} font={mono} size={34} bg={C.ink} color={C.white} rotate={-2}>
              fightclub-seven.vercel.app
            </Sticker>
          </div>
        </AbsoluteFill>
      </Paper>
    );
  }
  // bracket: 8 → 4 → 2 → 1, winner path lit
  const cols = [8, 4, 2, 1];
  const names = ["ZK Vote", "MemePay", "ChainChef", "DAOfund", "Rekt.ai", "PixelPay", "GasLess", "NFTicket"];
  const lit = (c) => frame >= 6 + c * 9;
  return (
    <Paper>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "20% 30%" }}>
        {cols.map((n, c) =>
          new Array(n).fill(0).map((_, k) => {
            const gap = 900 / n;
            const y = 90 + gap * k + gap / 2 - 36;
            const x = 120 + c * 400;
            const win = k === 0;
            const label = c === 0 ? names[k] : win ? "ZK Vote" : names[k * Math.pow(2, c)];
            return (
              <div key={`${c}-${k}`}>
                <div style={{ position: "absolute", left: x, top: y, width: 300, height: 72, boxSizing: "border-box", border: `3px solid ${C.ink}`, borderRadius: 14, background: win && lit(c) ? C.oracle : C.white, color: win && lit(c) ? C.white : C.ink, boxShadow: win && lit(c) ? `0 0 0 6px ${C.oracleSoft}, ${pop(6)}` : pop(4), fontFamily: display, fontWeight: 800, fontSize: 30, padding: "14px 20px" }}>
                  {label}
                </div>
                {c < 3 && <div style={{ position: "absolute", left: x + 300, top: y + 34, width: 100, height: 5, background: win && lit(c + 1) ? C.oracle : C.ink }} />}
              </div>
            );
          }),
        )}
      </AbsoluteFill>
      <div style={{ position: "absolute", right: 70, top: 120, display: "flex", flexDirection: "column", gap: 34, alignItems: "flex-end" }}>
        <Sticker at={30} bg={C.ink} color={C.white} rotate={-4} size={40}>0G · compute + storage</Sticker>
        <Sticker at={38} bg={C.crush} color={C.white} rotate={3} size={40}>Arkiv · public results</Sticker>
        <Sticker at={46} bg={C.oracle} color={C.white} rotate={-3} size={40}>ENS · fighter identity</Sticker>
      </div>
    </Paper>
  );
};
