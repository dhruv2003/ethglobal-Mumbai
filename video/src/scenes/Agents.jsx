import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { C, Paper, Headline, Card, Sticker, display, mono, body, pop, useSpring, clamp, lerp, Cursor } from "../theme.jsx";

const LANES = [
  { name: "Code", color: C.oracle, logs: ["parsing 214 files", "contracts/Vote.sol", "architecture mapped"], speed: 1.0 },
  { name: "README", color: C.amber, logs: ["reading setup steps", "npm install ✓", "setup verified"], speed: 1.25 },
  { name: "Security", color: C.crush, logs: ["reentrancy scan", "secrets scan", "0 critical issues"], speed: 0.9 },
  { name: "Live site", color: C.mint, logs: ["GET / → 200", "click 'Connect wallet'", "flow works"], speed: 1.1 },
  { name: "Demo video", color: "#7B4DFF", logs: ["frame 412 / 2880", "frame 2103 / 2880", "matches the repo"], speed: 0.95 },
  { name: "Claims", color: C.ink, logs: ["'gasless votes'", "checking tx hash", "claim proven ✓"], speed: 1.15 },
];
const DONE = 110;

/* 0:20–0:27 — one agent splits into six that work at the same time. */
export const Agents = () => {
  const frame = useCurrentFrame();
  const split = useSpring(14, { damping: 13, stiffness: 160, mass: 0.7 });
  const merge = lerp(frame, 125, 142, 0, 1, Easing.in(Easing.cubic));
  const dossier = useSpring(138, { damping: 11, stiffness: 200, mass: 0.6 });
  const W = 470, H = 230, GX = 40, GY = 40;
  const gridW = 3 * W + 2 * GX, gridH = 2 * H + GY;
  const ox = (1920 - gridW) / 2, oy = 330;
  return (
    <Paper>
      <div style={{ position: "absolute", top: 70, left: 0, right: 0, textAlign: "center" }}>
        <Headline words={["6", "agents.", "In", "parallel."]} size={110} highlight={{ 3: C.sunny }} />
        <div style={{ fontFamily: body, fontWeight: 600, fontSize: 34, color: "#5b5566", marginTop: 14, opacity: lerp(frame, 20, 30, 0, 1) }}>
          Not one by one. All at once.
        </div>
      </div>

      {/* the parent agent, before it splits */}
      {frame < 22 && (
        <div style={{ position: "absolute", left: 960 - 90, top: 560 - 90, width: 180, height: 180, transform: `scale(${interpolate(useSpringVal(frame), [0, 1], [0, 1])})` }}>
          <AgentOrb />
        </div>
      )}

      {LANES.map((l, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const tx = ox + col * (W + GX), ty = oy + row * (H + GY);
        const cx = 960 - W / 2, cy = 560 - H / 2;
        const x = interpolate(split, [0, 1], [cx, tx]) * (1 - merge) + (960 - W / 2) * merge;
        const y = interpolate(split, [0, 1], [cy, ty]) * (1 - merge) + (600 - H / 2) * merge;
        const sc = interpolate(split, [0, 1], [0.2, 1]) * (1 - merge * 0.7);
        const p = Math.min(1, Math.max(0, ((frame - 24) / (DONE - 24)) * l.speed));
        const done = p >= 1 || frame >= DONE;
        const logIdx = Math.min(2, Math.floor(p * 3));
        return (
          <div key={l.name} style={{ position: "absolute", left: x, top: y, width: W, height: H, transform: `scale(${sc}) rotate(${merge * (i - 2.5) * 6}deg)`, opacity: 1 - lerp(frame, 140, 144, 0, 1) }}>
            <Card style={{ width: "100%", height: "100%", padding: 26, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 14 }} shadow={7}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: l.color, border: `3px solid ${C.ink}` }} />
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 38, letterSpacing: "-0.02em" }}>{l.name}</div>
                <div style={{ marginLeft: "auto", fontFamily: mono, fontSize: 20, color: "#5b5566" }}>agent {i + 1}</div>
              </div>
              <div style={{ fontFamily: mono, fontSize: 24, color: done ? C.mint : C.ink, height: 34 }}>
                {done ? `✓ ${l.logs[2]}` : `› ${l.logs[logIdx]}${".".repeat(1 + (Math.floor(frame / 5) % 3))}`}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ height: 26, borderRadius: 13, border: `3px solid ${C.ink}`, background: C.sunken, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(done ? 1 : p) * 100}%`, background: done ? C.mint : l.color, borderRight: p > 0 && !done ? `3px solid ${C.ink}` : "none" }} />
              </div>
            </Card>
          </div>
        );
      })}

      {/* stopwatch comparison */}
      <div style={{ position: "absolute", right: 80, bottom: 54, display: "flex", gap: 18, opacity: lerp(frame, 40, 50, 0, 1) * (1 - merge) }}>
        <Card style={{ padding: "12px 22px", fontFamily: mono, fontSize: 26 }} shadow={5}>
          ⏱ {`00:${String(Math.min(59, Math.floor(lerp(frame, 24, DONE, 0, 58)))).padStart(2, "0")}`}
        </Card>
      </div>

      {/* everything lands in one evidence dossier */}
      {frame >= 138 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 220 }}>
          <div style={{ transform: `scale(${interpolate(dossier, [0, 1], [0.3, 1])}) rotate(${interpolate(dossier, [0, 1], [-8, -2])}deg)` }}>
            <Card style={{ width: 760, padding: 36 }} bg={C.white} shadow={14}>
              <div style={{ fontFamily: mono, fontSize: 22, color: "#5b5566" }}>EVIDENCE DOSSIER · zkvote.fightclub.eth</div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 60, letterSpacing: "-0.02em", margin: "8px 0 18px" }}>Ready for the judges</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {LANES.map((l) => (
                  <span key={l.name} style={{ fontFamily: body, fontWeight: 700, fontSize: 24, padding: "8px 14px", borderRadius: 999, border: `3px solid ${C.ink}`, background: C.sunnySoft }}>
                    ✓ {l.name}
                  </span>
                ))}
              </div>
            </Card>
          </div>
          <div style={{ position: "absolute", right: 260, top: 420 }}>
            <Sticker at={150} bg={C.crush} color={C.white} rotate={8} size={40}>
              58 sec, not 6 hrs
            </Sticker>
          </div>
        </AbsoluteFill>
      )}
    </Paper>
  );
};

const useSpringVal = (frame) => Math.min(1, frame / 8);

const AgentOrb = () => (
  <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: C.oracle, border: `4px solid ${C.ink}`, boxShadow: pop(8), display: "grid", placeItems: "center", fontFamily: display, fontWeight: 800, fontSize: 60, color: C.white }}>
    AI
  </div>
);

/* 0:27–0:34 — agents use the app on real devices. */
const DEVICES = [
  { kind: "phone", x: 120, w: 250, h: 500, app: "Wallet", path: [[60, 360, 60], [150, 200, 95], [120, 420, 140]] },
  { kind: "phone", x: 420, w: 250, h: 500, app: "Vote", path: [[130, 300, 50], [60, 380, 92], [150, 250, 130]], bug: 100 },
  { kind: "tablet", x: 720, w: 400, h: 520, app: "Dashboard", path: [[200, 300, 58], [300, 180, 100], [120, 400, 150]] },
  { kind: "phone", x: 1170, w: 250, h: 500, app: "Sign up", path: [[120, 260, 64], [120, 330, 98], [130, 420, 136]] },
  { kind: "laptop", x: 1470, w: 340, h: 260, app: "Web", path: [[100, 100, 70], [230, 160, 120]] },
];

export const Devices = () => {
  const frame = useCurrentFrame();
  return (
    <Paper color={C.ink} dot="rgba(255,255,255,0.05)">
      <div style={{ position: "absolute", top: 60, left: 0, right: 0, textAlign: "center" }}>
        <Headline words={["Tested", "on", "real", "devices."]} size={104} color={C.white} highlight={{ 2: C.crush }} />
        <div style={{ fontFamily: body, fontWeight: 600, fontSize: 34, color: "#cfc8da", marginTop: 12, opacity: lerp(frame, 18, 28, 0, 1) }}>
          Agents tap, scroll and try to break your app.
        </div>
      </div>
      {DEVICES.map((d, i) => (
        <Device key={i} d={d} i={i} />
      ))}
      <div style={{ position: "absolute", left: 120, bottom: 60 }}>
        <Sticker at={124} font={mono} size={28} bg={C.white} rotate={-2}>
          ● 5 recordings → saved on 0G Storage ✓
        </Sticker>
      </div>
      <div style={{ position: "absolute", right: 110, bottom: 60 }}>
        <Sticker at={136} bg={C.sunny} rotate={4} size={34}>
          1 bug found before judging
        </Sticker>
      </div>
    </Paper>
  );
};

const Device = ({ d, i }) => {
  const frame = useCurrentFrame();
  const on = useSpring(8 + i * 5, { damping: 12, stiffness: 170, mass: 0.6 });
  const lit = frame > 14 + i * 5;
  const top = d.kind === "laptop" ? 470 : d.kind === "tablet" ? 330 : 340;
  const bezel = d.kind === "phone" ? 14 : 18;
  // cursor path: hop between taps
  let cx = d.path[0][0], cy = d.path[0][1], tap = null;
  for (let k = 0; k < d.path.length; k++) {
    const [x, y, t] = d.path[k];
    const prev = k === 0 ? [d.w / 2, d.h, t - 30] : d.path[k - 1];
    if (frame >= prev[2]) {
      const m = lerp(frame, prev[2] + 4, t - 4, 0, 1, Easing.inOut(Easing.cubic));
      cx = interpolate(m, [0, 1], [prev[0], x]);
      cy = interpolate(m, [0, 1], [prev[1], y]);
      if (frame >= t - 4) tap = t;
    }
  }
  const bug = d.bug != null && frame >= d.bug;
  const scrollY = lerp(frame, 40, 190, 0, -120);
  const screenH = d.kind === "laptop" ? d.h : d.h - bezel * 2;
  return (
    <div style={{ position: "absolute", left: d.x, top, transform: `translateY(${interpolate(on, [0, 1], [500, 0])}px)` }}>
      <div
        style={{
          width: d.w,
          height: d.h,
          background: C.ink,
          border: `4px solid ${C.white}`,
          borderRadius: d.kind === "laptop" ? 16 : 40,
          padding: bezel,
          boxSizing: "border-box",
          boxShadow: `8px 8px 0 ${C.oracle}`,
          position: "relative",
        }}
      >
        <div style={{ width: "100%", height: "100%", borderRadius: d.kind === "laptop" ? 6 : 26, overflow: "hidden", background: lit ? (bug ? C.crushSoft : C.paper) : "#000", position: "relative" }}>
          {lit && (
            <div style={{ transform: `translateY(${scrollY}px)`, padding: 14 }}>
              <div style={{ height: 34, borderRadius: 8, background: [C.oracle, C.crush, C.sunny, C.mint, C.oracle][i], border: `2px solid ${C.ink}`, fontFamily: display, fontWeight: 800, fontSize: 18, color: i === 2 ? C.ink : C.white, padding: "4px 10px" }}>
                {d.app}
              </div>
              {new Array(7).fill(0).map((_, k) => (
                <div key={k} style={{ marginTop: 12, height: k % 3 === 1 ? 44 : 22, borderRadius: 8, background: k % 3 === 1 ? C.white : C.sunken, border: k % 3 === 1 ? `2px solid ${C.ink}` : "none", width: `${70 + ((k * 37) % 30)}%` }} />
              ))}
            </div>
          )}
          {lit && <Cursor x={cx - 4} y={cy - 4 - top + top} tap={tap} label={null} color={C.crush} />}
          {bug && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Sticker at={d.bug} bg={C.crush} color={C.white} rotate={-10} size={26}>
                ✕ button dead
              </Sticker>
            </div>
          )}
          {lit && (
            <div style={{ position: "absolute", top: 8, right: 10, fontFamily: mono, fontSize: 13, color: C.crushInk, opacity: frame % 20 < 12 ? 1 : 0.3 }}>● REC</div>
          )}
        </div>
      </div>
      {d.kind === "laptop" && <div style={{ width: d.w + 60, marginLeft: -30, height: 22, background: C.white, borderRadius: "0 0 18px 18px", border: `4px solid ${C.ink}` }} />}
      <div style={{ textAlign: "center", fontFamily: mono, fontSize: 18, color: "#cfc8da", marginTop: 14 }}>
        {["iPhone 15", "Pixel 8", "iPad Air", "Galaxy S24", "MacBook"][i]}
      </div>
    </div>
  );
};
