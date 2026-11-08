import { AbsoluteFill, interpolate, useCurrentFrame, random, Easing } from "remotion";
import { C, Sticker, Fighter, Kickoff, display, mono, body, pop, clamp, shake } from "../theme.jsx";
import { makeCamera, worldTransform, camSpeed, Plane, BB } from "../stage3d.jsx";
import T from "../timing.json";

/*
 * 0:22–0:28 — "one agent" is really six.
 * Flat telephoto front view: six agents stand one behind another, so they stack into
 * a single figure. A dolly zoom + corner swing reveals the line in depth. They fan out
 * into neon lanes, race through task gates in parallel, the camera snaps flat into a
 * lineup, and while it's flat they merge into one evidence dossier that opens in 3D.
 */

const A = T.agents;
const FLOOR = 200;
const LANES = [
  { name: "Code", color: "#4D6BFF", arche: "circuit", logs: ["parse 214 files", "map architecture", "rate code quality"] },
  { name: "README", color: C.sunny, arche: "raju", logs: ["read setup", "npm install", "setup verified"] },
  { name: "Security", color: C.crush, arche: "gogo", logs: ["reentrancy scan", "secrets scan", "0 critical"] },
  { name: "Live site", color: "#2BD98B", arche: "kaali-peeli", logs: ["open site", "connect wallet", "flow works"] },
  { name: "Demo video", color: "#A57BFF", arche: "majnu-bhai", logs: ["watch demo", "match to repo", "no fakes"] },
  { name: "Claims", color: "#FF9A3D", arche: "ember", logs: ["'gasless votes'", "find tx hash", "claim proven"] },
];
const LANE_X = LANES.map((_, i) => (i - 2.5) * 260);

const cam = makeCamera([
  // f,  P,     yaw, el, s,    px, py,   pz
  [0, 60000, 0, 0, 1.7, 0, -40, 0],
  [10, 60000, 0, 0, 1.75, 0, -40, 0],
  [36, 900, 52, 10, 0.78, 0, -60, -750],
  [58, 1150, 16, 36, 0.6, 0, -20, -800],
  [82, 820, -30, 8, 0.78, 0, -80, -250],
  [110, 900, -16, 14, 0.72, 0, -80, 300],
  [118, 50000, 0, 0, 0.82, 0, -110, 500],
  [128, 50000, 0, 0, 0.84, 0, -140, 500],
  [152, 1000, 26, 12, 0.86, 0, -180, 520],
  [180, 1100, 36, 18, 0.84, 0, -180, 520],
]);

function agentPos(i, f) {
  const lineZ = -i * 300; // stacked one behind another
  let x = 0, z = lineZ, y = 0;
  if (f >= A.fan - 4) {
    const t = interpolate(f, [A.fan - 4, A.raceStart], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    x = LANE_X[i] * t;
    z = lineZ + (A.zStart - lineZ) * t;
    y = -Math.sin(t * Math.PI) * 160; // hop into the lane
  }
  if (f >= A.raceStart) {
    const t = interpolate(f, [A.raceStart, A.finish[i]], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
    z = A.zStart + (A.zEnd - A.zStart) * t;
    x = LANE_X[i];
    y = f < A.finish[i] ? -Math.abs(Math.sin(f / 2.2 + i)) * 18 : 0;
  }
  if (f >= A.merge) {
    const t = interpolate(f, [A.merge, A.dossier], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
    x = LANE_X[i] * (1 - t);
  }
  return { x, y, z };
}

const passed = (i, gz, f) => {
  if (f < A.raceStart) return false;
  const t = (gz - A.zStart) / (A.zEnd - A.zStart);
  return f >= A.raceStart + (A.finish[i] - A.raceStart) * Math.sqrt(t); // inverse of quad ease-in
};
const passFrame = (i, gz) => A.raceStart + (A.finish[i] - A.raceStart) * Math.sqrt((gz - A.zStart) / (A.zEnd - A.zStart));

export const AgentsArena = () => {
  const frame = useCurrentFrame();
  const c = cam(frame);
  const speed = camSpeed(c, cam(frame - 1));
  const yaw = c.yaw;
  const dossierIn = interpolate(frame, [A.dossier, A.dossier + 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
  const sh = shake(frame, A.dossier, 22, 10);
  const flash = frame >= A.dossier && frame < A.dossier + 2;
  const allDone = frame >= Math.max(...A.finish);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #2a2150 0%, #15112a 60%, #0b0916 100%)`, overflow: "hidden" }}>
      <AbsoluteFill style={{ perspective: c.P, perspectiveOrigin: "50% 50%", filter: [speed > 2 ? `blur(${Math.min(5, (speed - 2) * 0.55)}px)` : "", flash ? "invert(1)" : ""].join(" ").trim() || undefined }}>
        <div style={{ position: "absolute", left: "50%", top: "56%", transformStyle: "preserve-3d", transform: worldTransform(c, 1, sh) }}>
          {/* neon grid floor */}
          <Plane x={0} y={FLOOR} z={-300} w={5200} h={4400} rot="rotateX(90deg)" style={{ background: "#120e24", backgroundImage: "linear-gradient(rgba(124,107,255,0.35) 3px, transparent 3px), linear-gradient(90deg, rgba(124,107,255,0.35) 3px, transparent 3px)", backgroundSize: "130px 130px" }} />
          {/* lanes */}
          {LANES.map((l, i) => {
            const lit = frame >= A.fan + 4 + i * 2;
            return (
              <Plane key={l.name} x={LANE_X[i]} y={FLOOR - 1} z={(A.zStart + A.zEnd) / 2 - 100} w={200} h={A.zEnd - A.zStart + 600} rot="rotateX(90deg)"
                style={{ opacity: lit ? 1 : 0, background: `linear-gradient(${l.color}00, ${l.color}55)`, borderLeft: `6px solid ${l.color}`, borderRight: `6px solid ${l.color}`, boxShadow: `0 0 40px ${l.color}`, backgroundImage: `repeating-linear-gradient(${l.color}AA 0 40px, transparent 40px 120px)`, backgroundSize: "8px 120px", backgroundRepeat: "repeat-y", backgroundPosition: `center ${frame * 18}px` }} />
            );
          })}
          {/* light trails behind racing agents */}
          {LANES.map((l, i) => {
            if (frame < A.raceStart || frame >= A.merge) return null;
            const p = agentPos(i, frame);
            const len = Math.max(0, p.z - A.zStart);
            return <Plane key={`t${i}`} x={LANE_X[i]} y={FLOOR - 2} z={A.zStart + len / 2} w={90} h={len} rot="rotateX(90deg)" style={{ background: `linear-gradient(${l.color}, ${l.color}00)`, filter: "blur(2px)", opacity: 0.9 }} />;
          })}
          {/* task gates: arches facing the agents, one per lane per step */}
          {LANES.map((l, i) =>
            A.gates.map((gz, g) => {
              const ok = passed(i, gz, frame);
              const show = frame >= A.fan + 8 + g * 3;
              const pf = passFrame(i, gz);
              const pop2 = ok ? interpolate(frame - pf, [0, 3, 8], [1.25, 1.25, 1], clamp) : 1;
              return (
                <Plane key={`g${i}-${g}`} x={LANE_X[i]} y={FLOOR - 150} z={gz} w={220} h={300}
                  style={{ opacity: show ? 1 : 0, transform: `translate3d(${LANE_X[i]}px,${FLOOR - 150}px,${gz}px) scale(${pop2})`, border: `10px solid ${ok ? "#2BD98B" : l.color}`, borderBottom: "none", borderRadius: "26px 26px 0 0", boxShadow: `0 0 34px ${ok ? "#2BD98B" : l.color}, inset 0 0 30px ${ok ? "#2BD98B" : l.color}66`, background: ok ? "rgba(43,217,139,0.12)" : "transparent", boxSizing: "border-box" }}>
                  <div style={{ position: "absolute", left: "50%", top: -66, transform: "translateX(-50%)", background: ok ? "#2BD98B" : C.ink, color: ok ? C.ink : C.white, border: `4px solid ${ok ? C.ink : l.color}`, borderRadius: 10, padding: "4px 12px", fontFamily: mono, fontSize: 22, whiteSpace: "nowrap" }}>
                    {ok ? "✓ " : ""}{l.logs[g]}
                  </div>
                </Plane>
              );
            }),
          )}
          {/* data packets bursting up from each passed gate */}
          {LANES.map((l, i) =>
            A.gates.map((gz, g) => {
              const d = frame - passFrame(i, gz);
              if (d < 0 || d > 16) return null;
              return new Array(5).fill(0).map((_, k) => (
                <BB key={`p${i}-${g}-${k}`} x={LANE_X[i] + (random(`px${i}${g}${k}`) - 0.5) * 220} y={FLOOR - 300 - d * (14 + k * 4)} z={gz} yaw={yaw}>
                  <div style={{ width: 22, height: 22, background: k % 2 ? l.color : C.white, border: `3px solid ${C.ink}`, opacity: 1 - d / 16, transform: `rotate(${d * 20}deg)` }} />
                </BB>
              ));
            }),
          )}
          {/* agents */}
          {LANES.map((l, i) => {
            const p = agentPos(i, frame);
            const done = frame >= A.finish[i];
            if (frame >= A.dossier) return null;
            return (
              <div key={`a${i}`} style={{ position: "absolute", left: 0, top: 0, transformStyle: "preserve-3d" }}>
                <Plane x={p.x} y={FLOOR - 3} z={p.z} w={240} h={110} rot="rotateX(90deg)" style={{ borderRadius: "50%", background: `radial-gradient(${l.color}cc, ${l.color}00 70%)` }} />
                <BB x={p.x} y={FLOOR + p.y} z={p.z} yaw={yaw}>
                  <div style={{ position: "relative", textAlign: "center" }}>
                    {frame >= A.fan - 4 && (
                      <div style={{ position: "absolute", left: "50%", top: -52, transform: "translateX(-50%)", whiteSpace: "nowrap", background: done ? "#2BD98B" : l.color, color: C.ink, border: `4px solid ${C.ink}`, borderRadius: 999, padding: "4px 16px", fontFamily: display, fontWeight: 800, fontSize: 30, boxShadow: pop(4) }}>
                        {done ? "✓ " : ""}{l.name}
                      </div>
                    )}
                    <Fighter project={{ id: `agent-${i}`, name: l.name, archetype: l.arche, tracks: [] }} pose={frame >= A.raceStart && !done ? (frame % 6 < 3 ? "wind" : "bob") : done ? "victory" : "idle"} scale={12} />
                  </div>
                </BB>
              </div>
            );
          })}
          {/* dossier: opens in 3D after the merge */}
          {frame >= A.dossier && (
            <Plane x={0} y={FLOOR - 260} z={520} w={980} h={470} style={{ transform: `translate3d(0px,${FLOOR - 260}px,520px) scale(${dossierIn}) rotateY(${(1 - dossierIn) * 90}deg)`, background: C.white, border: `6px solid ${C.ink}`, borderRadius: 30, boxShadow: `14px 14px 0 ${C.sunny}, 0 0 90px rgba(255,212,59,0.5)`, padding: 44, boxSizing: "border-box" }}>
              <div style={{ fontFamily: mono, fontSize: 24, color: "#5b5566" }}>EVIDENCE DOSSIER · zkvote.fightclub.eth</div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 72, letterSpacing: "-0.03em", margin: "6px 0 22px", color: C.ink }}>Ready for the judges</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {LANES.map((l, k) => (
                  <span key={l.name} style={{ fontFamily: body, fontWeight: 800, fontSize: 28, padding: "8px 18px", borderRadius: 999, border: `4px solid ${C.ink}`, background: l.color, color: C.ink, opacity: frame >= A.dossier + 4 + k * 2 ? 1 : 0 }}>
                    ✓ {l.name}
                  </span>
                ))}
              </div>
            </Plane>
          )}
        </div>
      </AbsoluteFill>

      {/* ---------- screen-space story ---------- */}
      <Story frame={frame} allDone={allDone} />
      {speed > 3 && <Speed frame={frame} k={Math.min(1, (speed - 3) / 6)} />}
      <Vignette />
    </AbsoluteFill>
  );
};

const Story = ({ frame, allDone }) => {
  const pop2 = (at) => interpolate(frame - at, [0, 4, 7], [2.2, 0.92, 1], clamp);
  const out = (a, b) => interpolate(frame, [a, b], [1, 0], clamp);
  return (
    <>
      {frame < 22 && (
        <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", opacity: out(17, 22) }}>
          <div style={{ display: "inline-block", transform: `scale(${pop2(2)})` }}>
            <Kickoff size={130} color={C.white}>One agent?</Kickoff>
          </div>
        </div>
      )}
      {frame >= 22 && frame < 50 && (
        <div style={{ position: "absolute", top: 90, width: "100%", textAlign: "center", opacity: out(45, 50) }}>
          <div style={{ display: "inline-block", transform: `scale(${pop2(22)}) rotate(-4deg)` }}>
            <Kickoff size={150} color={C.sunny}>Nope. SIX.</Kickoff>
          </div>
        </div>
      )}
      {frame >= 56 && (
        <div style={{ position: "absolute", top: 56, left: 70 }}>
          <div style={{ transform: `translateX(${interpolate(frame, [56, 64], [-900, 0], { ...clamp, easing: Easing.out(Easing.back(1.4)) })}px)` }}>
            <div style={{ fontFamily: display, fontWeight: 800, fontSize: 96, color: C.white, letterSpacing: "-0.035em", lineHeight: 0.95, WebkitTextStroke: `2px ${C.ink}`, textShadow: `0 6px 0 ${C.ink}` }}>
              6 agents. In <span style={{ color: C.sunny }}>parallel.</span>
            </div>
            <div style={{ fontFamily: body, fontWeight: 700, fontSize: 34, color: "#d9d2ea", marginTop: 8 }}>Not one by one. All at once.</div>
          </div>
        </div>
      )}
      {frame >= 62 && (
        <div style={{ position: "absolute", right: 70, bottom: 56, background: allDone ? "#2BD98B" : C.white, border: `4px solid ${C.ink}`, borderRadius: 14, boxShadow: pop(6), padding: "10px 22px", fontFamily: mono, fontSize: 34 }}>
          ⏱ 00:{String(Math.min(58, Math.round(interpolate(frame, [62, 113], [0, 58], clamp)))).padStart(2, "0")}
        </div>
      )}
      {frame >= 150 && (
        <div style={{ position: "absolute", right: 80, top: 250 }}>
          <Sticker at={150} bg={C.crush} color={C.white} rotate={7} size={46}>
            58 sec, not 6 hrs
          </Sticker>
        </div>
      )}
    </>
  );
};

const Speed = ({ frame, k }) => (
  <AbsoluteFill style={{ opacity: k * 0.75 }}>
    {new Array(30).fill(0).map((_, i) => {
      const a = (i / 30) * Math.PI * 2 + random(`as${i}`) * 0.2;
      return <div key={i} style={{ position: "absolute", left: 960, top: 540, width: 1400, height: 5 + (i % 3) * 5, background: "rgba(255,255,255,0.55)", transformOrigin: "0 50%", transform: `rotate(${a}rad) translateX(${420 + ((frame * 50 + i * 90) % 400)}px)` }} />;
    })}
  </AbsoluteFill>
);

const Vignette = () => <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />;
