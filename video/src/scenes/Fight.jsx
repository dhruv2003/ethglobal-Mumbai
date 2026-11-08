import { AbsoluteFill, interpolate, useCurrentFrame, random, Easing } from "remotion";
import { C, Card, Sticker, Fighter, Kickoff, display, mono, body, pop, shake, lerp, clamp } from "../theme.jsx";
import { FIGHTER_A, FIGHTER_B, JUDGES } from "../cast.js";
import { FIGHTER_ROSTER } from "../lib/fighterRoster.js";
import T from "../timing.json";

/*
 * 0:41–0:51 — the fight, staged as a 3D arena with a "perspective illusion" camera:
 * it opens on a flat, side-on telephoto view that reads like a 2D fighting game,
 * dolly-zooms into deep perspective (crowd and stands stretch open), swings to corner
 * views, snaps flat again, and orbits in slow motion around the knockout.
 * The camera never holds still. Everything is a pure function of the frame.
 */

const F = T.fight;
const FLOOR = 260; // y of the ring mat (CSS y points down)
const HOME = { a: -310, b: 310 };
const SUPER = F.hits.find((h) => h.super);

/* ---------------- camera ---------------- */
// [frame, perspective, yaw°, elevation°, scale, pivotX, pivotY]
const KEYS = [
  [0, 60000, 0, 0, 1.0, 0, 40],
  [F.vs + 2, 60000, 0, 0, 1.02, 0, 40],
  [34, 1000, 28, 16, 0.78, 0, 0],
  [64, 1250, 16, 11, 0.84, 0, 10],
  [F.go, 1500, 0, 7, 1.0, 0, 40],
  [118, 1450, -5, 9, 1.04, 40, 40],
  [134, 50000, 0, 0, 1.06, 0, 40],
  [140, 50000, 0, 0, 1.06, 0, 40],
  [158, 950, -30, 17, 0.86, 160, 20],
  [184, 1100, -20, 12, 0.92, 80, 30],
  [F.superCharge + 4, 760, -6, -1, 1.18, -190, 110],
  [SUPER.at - 2, 720, -4, -2, 1.24, -140, 110],
  [SUPER.at + 6, 900, 8, 6, 1.0, 120, 40],
  [F.ko, 1000, 36, 14, 0.86, 420, 50],
  [300, 1300, 52, 28, 0.8, 220, 40],
];

// Fritsch–Carlson monotone cubic: speed never jumps between keys.
function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const xs = KEYS.map((k) => k[0]);
const curves = [1, 2, 3, 4, 5, 6].map((c) => monotone(xs, KEYS.map((k) => (c === 1 ? Math.log(k[c]) : k[c]))));
const camAt = (f) => {
  const [lp, yaw, el, s, px, py] = curves.map((fn) => fn(f));
  return { P: Math.exp(lp), yaw, el, s, px, py };
};

/* ---------------- choreography ---------------- */
function fighterState(side, frame) {
  const other = side === "a" ? "b" : "a";
  const dir = side === "a" ? 1 : -1;
  let x = HOME[side], y = 0, z = 0, pose = frame % 20 < 10 ? "idle" : "bob", rot = 0, glow = 0;
  // walk in during the flat intro
  if (frame < F.vs + 4) x = interpolate(frame, [0, F.vs + 4], [HOME[side] - dir * 700, HOME[side]], { ...clamp, easing: Easing.out(Easing.cubic) });
  for (const h of F.hits) {
    const d = frame - h.at;
    if (h.by === side) {
      const contact = HOME[other] - dir * 250;
      if (d >= -7 && d < 0) { x = interpolate(d, [-7, -1], [HOME[side], contact], clamp); pose = "wind"; if (h.super) y = -interpolate(d, [-7, -1], [0, 60], clamp); }
      if (d >= 0 && d < 14) { x = interpolate(d, [0, 3, 14], [contact, contact, HOME[side]], clamp); pose = d < 8 ? "punch" : pose; if (h === F.hits[3]) y = -Math.sin(Math.min(1, d / 8) * Math.PI) * 120; }
    } else if (d >= 0 && d < 14 && !h.super) {
      x = HOME[side] + dir * -1 * -interpolate(d, [0, 3, 14], [0, 80, 0], clamp) * -1;
      pose = "hit";
    }
  }
  // super move: A charges, B gets launched across the ring
  if (side === "a" && frame >= F.superCharge && frame < SUPER.at - 7) { pose = "wind"; glow = 1; x = HOME.a - 20 + Math.sin(frame * 2.2) * 4; }
  if (side === "a" && frame >= SUPER.at - 7 && frame < SUPER.at + 4) glow = 1;
  if (side === "b" && frame >= SUPER.at) {
    const stop = SUPER.at + 4; // hit-stop: freeze 4 frames
    const t = Math.max(0, frame - stop) / (F.ko - stop);
    const from = HOME.b, to = 640;
    if (frame < stop) { x = from; pose = "hit"; }
    else if (t < 1) {
      x = from + (to - from) * t;
      y = -Math.sin(t * Math.PI) * 380;
      z = -260 * t;
      rot = t * 540;
      pose = "hit";
    } else { x = to; z = -260; rot = 90; pose = "defeat"; y = -Math.max(0, Math.sin((frame - F.ko) / 3) * 30 * Math.exp(-(frame - F.ko) / 6)); }
  }
  if (side === "a" && frame >= F.ko) { pose = "victory"; y = -Math.abs(Math.sin((frame - F.ko) / 5)) * 70; }
  return { x, y, z, pose, rot, glow };
}

/* ---------------- 3D helpers ---------------- */
// A plane centred on (x,y,z); `rot` orients it (e.g. "rotateX(90deg)" for the floor).
const Plane = ({ x = 0, y = 0, z = 0, w, h, rot = "", style, children }) => (
  <div style={{ position: "absolute", left: -w / 2, top: -h / 2, width: w, height: h, transform: `translate3d(${x}px,${y}px,${z}px) ${rot}`, ...style }}>{children}</div>
);
// Upright card that always faces the camera; (x,y,z) is its foot.
const BB = ({ x, y, z, yaw, children, extra = "" }) => (
  <div style={{ position: "absolute", left: 0, top: 0, transformStyle: "preserve-3d", transform: `translate3d(${x}px,${y}px,${z}px) rotateY(${-yaw}deg) ${extra}` }}>
    <div style={{ position: "absolute", transform: "translate(-50%,-100%)" }}>{children}</div>
  </div>
);

const CROWD = (() => {
  const out = [];
  const ids = FIGHTER_ROSTER.map((r) => r.id);
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 13; k++) out.push({ x: -1320 + k * 220 + (row % 2) * 110, y: FLOOR - 40 - row * 130, z: -760 - row * 210, id: ids[(k * 5 + row * 3) % ids.length], seed: `${row}-${k}` });
  for (const side of [-1, 1])
    for (let k = 0; k < 5; k++) out.push({ x: side * (1060 + (k % 2) * 160), y: FLOOR - 30 - (k % 2) * 90, z: -380 + k * 190, id: ids[(k * 7 + (side > 0 ? 4 : 1)) % ids.length], seed: `s${side}-${k}` });
  return out;
})();

/* ---------------- scene ---------------- */
export const Fight = () => {
  const frame = useCurrentFrame();
  const cam = camAt(frame);
  const prev = camAt(frame - 1);
  const speed = Math.abs(cam.yaw - prev.yaw) + Math.abs(Math.log(cam.P / prev.P)) * 25 + Math.abs(cam.el - prev.el);
  const last = [...F.hits].reverse().find((h) => frame >= h.at);
  const sinceHit = last ? frame - last.at : 99;
  const kick = last ? Math.exp(-sinceHit / 4) * (last.super ? 0.18 : 0.07) : 0;
  const sh = last ? shake(frame, last.at, last.super ? 36 : 16, last.super ? 14 : 8) : { x: 0, y: 0 };
  const koSh = shake(frame, F.ko, 26, 12);
  const a = fighterState("a", frame), b = fighterState("b", frame);
  const flash = (sinceHit >= 0 && sinceHit < 2) || (frame >= F.ko && frame < F.ko + 2);
  const hpA = Math.max(0, 100 - F.hits.filter((h) => h.by === "b" && frame >= h.at).reduce((s, h) => s + h.dmg, 0));
  const hpB = Math.max(0, 100 - F.hits.filter((h) => h.by === "a" && frame >= h.at).reduce((s, h) => s + h.dmg, 0));
  const hype = (last && sinceHit < 16 ? 1 - sinceHit / 16 : 0) + (frame >= F.ko ? 1 : 0);
  const yaw = cam.yaw;

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, #3a2f63 0%, #1d1830 55%, ${C.ink} 100%)`, overflow: "hidden" }}>
      {/* the 3D world */}
      <AbsoluteFill style={{ perspective: cam.P, perspectiveOrigin: "50% 45%", filter: `${speed > 2 ? `blur(${Math.min(5, (speed - 2) * 0.6)}px)` : ""} ${flash ? "invert(1)" : ""}`.trim() || undefined }}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "52%",
            transformStyle: "preserve-3d",
            transform: `translate(${sh.x + koSh.x}px,${sh.y + koSh.y}px) scale3d(${cam.s * (1 + kick)},${cam.s * (1 + kick)},${cam.s * (1 + kick)}) rotateX(${-cam.el}deg) rotateY(${yaw}deg) translate3d(${-cam.px}px,${-cam.py}px,0px)`,
          }}
        >
          {/* back LED screen */}
          <Plane x={0} y={-310} z={-1500} w={2000} h={440} style={{ background: C.ink, border: `8px solid ${C.white}`, borderRadius: 24, boxShadow: `0 0 120px ${C.oracle}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 130, letterSpacing: "-0.03em", color: C.white }}>
              <span style={{ color: C.oracle }}>ZK VOTE</span> <span style={{ color: C.sunny }}>vs</span> <span style={{ color: C.crush }}>MEMEPAY</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 44, color: C.sunny }}>FIGHTCLUB · ROUND 1 · POOL 21,480 tFC</div>
          </Plane>
          {/* stands */}
          {[0, 1, 2].map((row) => (
            <Plane key={row} x={0} y={FLOOR - 40 - row * 130 + 60} z={-760 - row * 210 + 20} w={3000} h={120} style={{ background: row % 2 ? "#2a2347" : "#332a58", borderTop: `6px solid ${C.ink}` }} />
          ))}
          {/* arena floor */}
          <Plane x={0} y={FLOOR + 100} z={0} w={4200} h={3200} rot="rotateX(90deg)" style={{ background: "#241e3b", backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 3px, transparent 3.5px)", backgroundSize: "60px 60px" }} />
          {/* ring apron (front + sides) */}
          <Plane x={0} y={FLOOR + 50} z={500} w={1500} h={100} style={{ background: C.ink, border: `4px solid ${C.white}`, fontFamily: display, fontWeight: 800, fontSize: 64, color: C.sunny, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "0.1em" }}>FIGHTCLUB</Plane>
          <Plane x={-750} y={FLOOR + 50} z={0} w={1000} h={100} rot="rotateY(90deg)" style={{ background: C.oracle, border: `4px solid ${C.ink}` }} />
          <Plane x={750} y={FLOOR + 50} z={0} w={1000} h={100} rot="rotateY(90deg)" style={{ background: C.crush, border: `4px solid ${C.ink}` }} />
          {/* ring mat */}
          <Plane x={0} y={FLOOR} z={0} w={1500} h={1000} rot="rotateX(90deg)" style={{ background: C.sunny, border: `8px solid ${C.ink}`, boxSizing: "border-box", display: "grid", placeItems: "center" }}>
            <div style={{ width: 360, height: 360, borderRadius: "50%", border: `10px solid rgba(23,20,31,0.25)`, display: "grid", placeItems: "center", fontFamily: display, fontWeight: 800, fontSize: 90, color: "rgba(23,20,31,0.25)" }}>FC</div>
          </Plane>
          {/* posts */}
          {[[-750, -500, C.oracle], [750, -500, C.crush], [-750, 500, C.oracle], [750, 500, C.crush]].map(([x, z, col], i) => (
            <BB key={i} x={x} y={FLOOR} z={z} yaw={yaw}>
              <div style={{ width: 34, height: 300, background: col, border: `4px solid ${C.ink}`, borderRadius: 10 }} />
            </BB>
          ))}
          {/* ropes */}
          {[70, 145, 220].map((hgt, i) =>
            [
              <Plane key={`b${i}`} x={0} y={FLOOR - hgt} z={-500} w={1500} h={10} style={{ background: [C.oracle, C.white, C.crush][i], border: `2px solid ${C.ink}` }} />,
              <Plane key={`l${i}`} x={-750} y={FLOOR - hgt} z={0} w={1000} h={10} rot="rotateY(90deg)" style={{ background: [C.oracle, C.white, C.crush][i], border: `2px solid ${C.ink}` }} />,
              <Plane key={`r${i}`} x={750} y={FLOOR - hgt} z={0} w={1000} h={10} rot="rotateY(90deg)" style={{ background: [C.oracle, C.white, C.crush][i], border: `2px solid ${C.ink}` }} />,
            ],
          )}
          {/* crowd */}
          {CROWD.map((c, i) => {
            const bob = Math.abs(Math.sin(frame / (4 + random(c.seed) * 3) + i)) * (8 + hype * 40);
            return (
              <BB key={c.seed} x={c.x} y={c.y - bob} z={c.z} yaw={yaw}>
                <Fighter project={{ id: c.seed, name: c.seed, archetype: c.id, tracks: [] }} pose={hype > 0.5 && i % 3 === 0 ? "victory" : "idle"} scale={7} />
              </BB>
            );
          })}
          {/* camera flashes in the crowd after hits */}
          {hype > 0.3 &&
            CROWD.filter((_, i) => random(`fl${i}${Math.floor(frame / 3)}`) > 0.86).map((c) => (
              <BB key={`f${c.seed}`} x={c.x + 20} y={c.y - 120} z={c.z + 5} yaw={yaw}>
                <div style={{ width: 46, height: 46, background: C.white, clipPath: "polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%)" }} />
              </BB>
            ))}
          {/* judges' table, ringside right */}
          <BB x={960} y={FLOOR + 100} z={660} yaw={yaw}>
            <JudgesTable frame={frame} />
          </BB>
          {/* fighters */}
          <BB x={a.x} y={FLOOR + a.y} z={a.z} yaw={yaw}>
            <FighterSprite project={FIGHTER_A} st={a} />
          </BB>
          <BB x={b.x} y={FLOOR + b.y} z={b.z} yaw={yaw} extra={`rotateZ(${b.rot}deg)`}>
            <FighterSprite project={FIGHTER_B} st={b} flip />
          </BB>
          {/* hit words + damage labels, in the world next to the impact */}
          {F.hits.map((h, i) => {
            const d = frame - h.at;
            if (d < 0 || d > 24) return null;
            const tx = h.by === "a" ? HOME.b - 60 : HOME.a + 60;
            const sc = interpolate(d, [0, 3, 6], [0.2, 1.35, 1], clamp);
            return (
              <BB key={i} x={tx} y={FLOOR - 430 - d * 3} z={40} yaw={yaw}>
                <div style={{ transform: `scale(${sc * (h.super ? 1.5 : 1)}) rotate(${h.by === "a" ? 8 : -8}deg)`, opacity: interpolate(d, [18, 24], [1, 0], clamp), textAlign: "center" }}>
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <Burst color={h.by === "a" ? C.oracle : C.crush} />
                    <div style={{ position: "relative", fontFamily: display, fontWeight: 800, fontSize: 92, color: h.by === "a" ? C.sunny : C.crush, WebkitTextStroke: `5px ${C.ink}`, textShadow: `0 7px 0 ${C.ink}`, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{h.fx}</div>
                  </div>
                  <div style={{ position: "relative", zIndex: 2, display: "inline-block", marginTop: 34, background: h.label.startsWith("-") ? C.crush : C.ink, color: h.label.startsWith("-") ? C.white : C.sunny, border: `4px solid ${C.ink}`, borderRadius: 14, padding: "8px 20px", fontFamily: display, fontWeight: 800, fontSize: 44, whiteSpace: "nowrap", boxShadow: pop(6) }}>
                    {h.label} <span style={{ fontFamily: mono, fontSize: 24, color: C.white, opacity: 0.85 }}>· {JUDGES[h.judge].name}</span>
                  </div>
                </div>
              </BB>
            );
          })}
          {/* trash talk */}
          <Bubble frame={frame} from={126} to={152} x={HOME.b + 40} z={0} yaw={yaw} color={C.crush} text="README? Never heard of her." />
          <Bubble frame={frame} from={160} to={186} x={HOME.a - 40} z={0} yaw={yaw} color={C.oracle} text="Tests pass. Cope." />
        </div>
      </AbsoluteFill>

      {/* ---------- HUD (screen space) ---------- */}
      <Hud frame={frame} hpA={hpA} hpB={hpB} />
      <Combo frame={frame} />
      <VsSlam frame={frame} />
      <Countdown frame={frame} />
      <SuperCutIn frame={frame} />
      {frame >= F.ko && <KO frame={frame} />}
      {/* speed lines on fast camera moves */}
      {speed > 3 && <SpeedLines frame={frame} strength={Math.min(1, (speed - 3) / 6)} />}
    </AbsoluteFill>
  );
};

const FighterSprite = ({ project, st, flip }) => (
  <div style={{ position: "relative" }}>
    {st.glow > 0 && (
      <div style={{ position: "absolute", inset: -60, borderRadius: "50%", background: `radial-gradient(${C.sunny}cc, ${C.oracle}55 45%, transparent 70%)`, filter: "blur(4px)" }} />
    )}
    <Fighter project={project} pose={st.pose} scale={19} flip={flip} />
  </div>
);

const Bubble = ({ frame, from, to, x, z, yaw, color, text }) => {
  const d = frame - from;
  if (d < 0 || frame > to) return null;
  const s = interpolate(d, [0, 4, 7], [0, 1.15, 1], clamp) * interpolate(frame, [to - 4, to], [1, 0], clamp);
  return (
    <BB x={x} y={FLOOR - 440} z={z} yaw={yaw}>
      <div style={{ transform: `scale(${s})`, transformOrigin: "50% 100%" }}>
        <div style={{ background: C.white, border: `5px solid ${C.ink}`, borderRadius: 28, padding: "18px 28px", fontFamily: body, fontWeight: 800, fontSize: 40, whiteSpace: "nowrap", boxShadow: `8px 8px 0 ${color}` }}>{text}</div>
        <div style={{ width: 0, height: 0, margin: "-2px auto 0", borderLeft: "18px solid transparent", borderRight: "18px solid transparent", borderTop: `26px solid ${C.ink}` }} />
      </div>
    </BB>
  );
};

const JudgesTable = ({ frame }) => {
  const koCards = [10, 10, 9];
  return (
    <div style={{ width: 640, textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "flex-end", height: 330 }}>
        {JUDGES.map((j, i) => {
          const mine = [...F.hits].reverse().find((h) => h.judge === i && frame >= h.at && frame - h.at < 22);
          const ko = frame >= F.ko + 12 + i * 4;
          const card = ko ? koCards[i] : mine?.score;
          const up = card != null;
          return (
            <div key={j.name} style={{ position: "relative", width: 190 }}>
              {up && (
                <div style={{ position: "absolute", left: 40, top: -120, width: 110, height: 120, background: C.white, border: `5px solid ${C.ink}`, borderRadius: 12, fontFamily: display, fontWeight: 800, fontSize: 80, lineHeight: "110px", color: card >= 8 ? C.oracle : C.crushInk, boxShadow: pop(5), transform: `rotate(${i % 2 ? 6 : -6}deg)` }}>
                  {card}
                </div>
              )}
              <Fighter project={j.fighter} pose={up ? "victory" : "idle"} scale={8} />
            </div>
          );
        })}
      </div>
      <div style={{ background: C.white, border: `5px solid ${C.ink}`, borderRadius: 16, padding: "14px 0", fontFamily: display, fontWeight: 800, fontSize: 40, boxShadow: pop(8) }}>
        AI JUDGES
        <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 500, color: "#5b5566" }}>scoring live on 0G Compute</div>
      </div>
    </div>
  );
};

const Burst = ({ color }) => (
  <svg width="460" height="300" viewBox="-230 -150 460 300" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
    <polygon
      points={new Array(18).fill(0).map((_, i) => { const t = (i / 18) * Math.PI * 2, r = i % 2 ? 90 : 190; return `${Math.cos(t) * r * 1.2},${Math.sin(t) * r * 0.72}`; }).join(" ")}
      fill={C.white}
      stroke={C.ink}
      strokeWidth="7"
    />
    <circle r="50" fill={color} opacity="0.35" />
  </svg>
);

/* ---------- HUD pieces ---------- */
const Hud = ({ frame, hpA, hpB }) => {
  const enter = interpolate(frame, [F.go - 6, F.go + 6], [-220, 0], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const timer = Math.max(0, 60 - Math.floor(Math.max(0, frame - F.go) / 4));
  return (
    <div style={{ position: "absolute", top: 34, left: 60, right: 60, display: "flex", alignItems: "center", gap: 26, transform: `translateY(${enter}px)` }}>
      <Bar name="ZK VOTE" hp={hpA} color={C.oracle} project={FIGHTER_A} frame={frame} />
      <div style={{ width: 120, height: 100, background: C.sunny, border: `5px solid ${C.ink}`, borderRadius: 18, boxShadow: pop(6), display: "grid", placeItems: "center", fontFamily: display, fontWeight: 800, fontSize: 64 }}>{timer}</div>
      <Bar name="MEMEPAY" hp={hpB} color={C.crush} project={FIGHTER_B} frame={frame} flip />
    </div>
  );
};

const Bar = ({ name, hp, color, project, flip }) => (
  <div style={{ flex: 1, display: "flex", flexDirection: flip ? "row-reverse" : "row", alignItems: "center", gap: 16 }}>
    <div style={{ width: 96, height: 96, background: C.white, border: `5px solid ${C.ink}`, borderRadius: 18, overflow: "hidden", display: "grid", placeItems: "center", boxShadow: pop(5) }}>
      <Fighter project={project} pose="idle" scale={4.4} flip={flip} />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40, color: C.white, WebkitTextStroke: `1.5px ${C.ink}`, textAlign: flip ? "right" : "left", marginBottom: 6 }}>{name}</div>
      <div style={{ height: 44, border: `5px solid ${C.ink}`, borderRadius: 12, background: "#3b3456", overflow: "hidden", display: "flex", justifyContent: flip ? "flex-end" : "flex-start", boxShadow: pop(5) }}>
        <div style={{ width: `${hp}%`, background: hp < 30 ? C.crush : color, borderRight: flip ? "none" : `4px solid ${C.ink}`, borderLeft: flip ? `4px solid ${C.ink}` : "none" }} />
      </div>
    </div>
  </div>
);

const Combo = ({ frame }) => {
  // consecutive A hits → combo counter
  let streak = 0, at = null;
  for (const h of F.hits) {
    if (frame < h.at) break;
    if (h.by === "a") { streak++; at = h.at; } else { streak = 0; at = null; }
  }
  if (streak < 2 || frame - at > 30) return null;
  const d = frame - at;
  const s = interpolate(d, [0, 4, 8], [2, 0.9, 1], clamp);
  return (
    <div style={{ position: "absolute", left: 70, top: 220, transform: `scale(${s}) rotate(-8deg)`, opacity: interpolate(d, [24, 30], [1, 0], clamp) }}>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 120, lineHeight: 0.9, color: C.sunny, WebkitTextStroke: `5px ${C.ink}`, textShadow: `0 8px 0 ${C.ink}` }}>{streak} HITS!</div>
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: 44, color: C.white, WebkitTextStroke: `2px ${C.ink}` }}>COMBO</div>
    </div>
  );
};

const VsSlam = ({ frame }) => {
  const d = frame - F.vs;
  if (d < 0 || d > 22) return null;
  const s = interpolate(d, [0, 4, 7], [4, 0.9, 1], clamp);
  const out = interpolate(d, [16, 22], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <div style={{ transform: `scale(${s}) rotate(-8deg)` }}>
        <Kickoff size={280} color={C.sunny}>VS</Kickoff>
      </div>
      <div style={{ position: "absolute", left: 120, bottom: 140, transform: `translateX(${interpolate(d, [2, 8], [-600, 0], clamp)}px) rotate(-4deg)` }}>
        <Tape name="ZK VOTE" color={C.oracle} />
      </div>
      <div style={{ position: "absolute", right: 120, bottom: 140, transform: `translateX(${interpolate(d, [2, 8], [600, 0], clamp)}px) rotate(3deg)` }}>
        <Tape name="MEMEPAY" color={C.crush} />
      </div>
    </AbsoluteFill>
  );
};
const Tape = ({ name, color }) => (
  <div style={{ background: C.white, border: `5px solid ${C.ink}`, boxShadow: pop(10), padding: "10px 34px", fontFamily: display, fontWeight: 800, fontSize: 84, letterSpacing: "-0.02em", color }}>{name}</div>
);

const Countdown = ({ frame }) => {
  const marks = [...F.countdown, F.go];
  const idx = marks.findLastIndex((t) => frame >= t);
  if (idx < 0 || frame > F.go + 16) return null;
  const at = marks[idx];
  const d = frame - at;
  const isGo = idx === 3;
  const s = interpolate(d, [0, 3, 6], [3, 0.92, 1], clamp);
  const o = isGo ? interpolate(d, [10, 16], [1, 0], clamp) : interpolate(d, [8, 12], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      {isGo && d < 3 && <AbsoluteFill style={{ background: C.white }} />}
      <div style={{ transform: `scale(${s}) rotate(${isGo ? -6 : 0}deg)` }}>
        {isGo ? <Kickoff size={330} color={C.crush} glow="rgba(255,212,59,0.8)">FIGHT!</Kickoff> : <Kickoff size={360}>{3 - idx}</Kickoff>}
      </div>
    </AbsoluteFill>
  );
};

const SuperCutIn = ({ frame }) => {
  const from = F.superCharge, to = SUPER.at - 6;
  if (frame < from || frame > to) return null;
  const d = frame - from;
  const inX = interpolate(d, [0, 5], [-2200, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const outX = interpolate(frame, [to - 4, to], [0, 2200], clamp);
  const priya = JUDGES[1];
  return (
    <AbsoluteFill style={{ justifyContent: "center" }}>
      <div style={{ position: "absolute", left: -200, right: -200, top: 330, height: 360, background: C.oracle, borderTop: `8px solid ${C.ink}`, borderBottom: `8px solid ${C.ink}`, transform: `translateX(${inX + outX}px) skewY(-6deg)`, overflow: "hidden", display: "flex", alignItems: "center", gap: 60, paddingLeft: 360 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 30px, transparent 30px 90px)", backgroundPosition: `${-frame * 60}px 0` }} />
        <div style={{ position: "relative", transform: "skewY(6deg)" }}>
          <Fighter project={priya.fighter} pose="victory" scale={15} />
        </div>
        <div style={{ position: "relative", transform: "skewY(6deg)" }}>
          <div style={{ fontFamily: mono, fontSize: 34, color: C.sunny }}>JUDGE PRIYA RAMAN · TECH MODE</div>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 130, lineHeight: 0.95, color: C.white, WebkitTextStroke: `4px ${C.ink}`, textShadow: `0 8px 0 ${C.ink}`, letterSpacing: "-0.03em" }}>SUPER MOVE!</div>
          <div style={{ fontFamily: body, fontWeight: 800, fontSize: 40, color: C.white }}>Verified: it's actually live on-chain</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SpeedLines = ({ frame, strength }) => (
  <AbsoluteFill style={{ opacity: strength * 0.8, pointerEvents: "none" }}>
    {new Array(30).fill(0).map((_, i) => {
      const a = (i / 30) * Math.PI * 2 + random(`sl${i}`) * 0.2;
      return <div key={i} style={{ position: "absolute", left: 960, top: 540, width: 1400, height: 6 + (i % 3) * 6, background: "rgba(255,255,255,0.5)", transformOrigin: "0 50%", transform: `rotate(${a}rad) translateX(${420 + ((frame * 50 + i * 90) % 400)}px)` }} />;
    })}
  </AbsoluteFill>
);

const KO = ({ frame }) => {
  const d = frame - F.ko;
  const s = interpolate(d, [0, 4, 8], [5, 0.9, 1], clamp);
  const confetti = new Array(110).fill(0).map((_, i) => {
    const x = random(`cx${i}`) * 1920;
    const y = -60 + d * (9 + random(`cv${i}`) * 14) - 300 * random(`cy${i}`);
    return { x: x + Math.sin(d / 6 + i) * 30, y, r: d * 12 + i * 20, col: [C.oracle, C.crush, C.sunny, C.white][i % 4] };
  });
  return (
    <AbsoluteFill>
      {confetti.map((c, i) => (
        <div key={i} style={{ position: "absolute", left: c.x, top: c.y, width: 18, height: 28, background: c.col, border: `2px solid ${C.ink}`, transform: `rotate(${c.r}deg)` }} />
      ))}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `scale(${s}) rotate(-6deg)` }}>
          <Kickoff size={340} color={C.sunny}>K.O.!</Kickoff>
        </div>
        <div style={{ marginTop: 34 }}>
          <Sticker at={F.ko + 22} bg={C.oracle} color={C.white} size={52} rotate={3}>
            ZK Vote wins · 27.4 / 30
          </Sticker>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
