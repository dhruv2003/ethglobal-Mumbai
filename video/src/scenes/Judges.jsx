import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { C, Paper, Headline, Card, Sticker, Fighter, display, mono, body, pop, useSpring, lerp, Cursor } from "../theme.jsx";
import { JUDGES } from "../cast.js";

const MODES = [
  { label: "Generous", hint: "Rewards ambition, never fakes proof" },
  { label: "Balanced", hint: "Credits what's shown, discounts claims" },
  { label: "Strict", hint: "Every point needs evidence" },
];
const CHIPS = ["Go deep on technical", "UX & design", "Business impact", "Originality"];

/* 0:34–0:41 — character-select the judge, then tune the persona. */
export const Judges = () => {
  const frame = useCurrentFrame();
  const pick = 30; // Priya selected
  const tune = useSpring(44, { damping: 14, stiffness: 160, mass: 0.7 });
  // slider: Generous (0) → Balanced (1) → Strict (2)
  const knob = frame < 70 ? lerp(frame, 58, 70, 0, 1, Easing.inOut(Easing.cubic)) : lerp(frame, 84, 98, 1, 2, Easing.inOut(Easing.cubic));
  const mode = MODES[Math.round(knob)];
  const chipTap = 124;
  const techOn = frame >= chipTap + 2;
  const power = useSpring(chipTap + 4, { damping: 8, stiffness: 200, mass: 0.6 });
  const SL = 640; // slider length
  // cursor choreography (in panel coordinates)
  const panelX = 820, panelY = 300;
  const cur = (() => {
    if (frame < 56) return { x: 1300, y: 900, tap: null };
    if (frame < 104) return { x: panelX + 60 + (knob / 2) * SL, y: panelY + 250, tap: frame >= 58 ? 58 : null };
    const m = lerp(frame, 104, chipTap - 2, 0, 1, Easing.inOut(Easing.cubic));
    return { x: interpolate(m, [0, 1], [panelX + 60 + SL, panelX + 190]), y: interpolate(m, [0, 1], [panelY + 250, panelY + 430]), tap: frame >= chipTap ? chipTap : null };
  })();

  return (
    <Paper>
      <div style={{ position: "absolute", top: 54, left: 110 }}>
        <Headline words={["Tune", "your", "judges."]} size={104} highlight={{ 2: C.sunny }} />
      </div>
      <div style={{ position: "absolute", top: 82, right: 110, fontFamily: mono, fontSize: 24, color: "#5b5566", opacity: lerp(frame, 10, 20, 0, 1) }}>SELECT YOUR JUDGE</div>

      {/* character select row → collapses to the left column once a judge is picked */}
      {JUDGES.map((j, i) => {
        const s = useSpringLocal(frame, 4 + i * 5);
        const chosen = i === 1;
        const toLeft = tune;
        const baseX = 260 + i * 480, baseY = 300;
        const x = chosen ? interpolate(toLeft, [0, 1], [baseX, 110]) : baseX;
        const y = chosen ? interpolate(toLeft, [0, 1], [baseY, 300]) : baseY + interpolate(toLeft, [0, 1], [0, 900]);
        const sel = frame >= pick && chosen;
        return (
          <div key={j.name} style={{ position: "absolute", left: x, top: y, opacity: chosen ? 1 : interpolate(toLeft, [0, 0.25], [1, 0], { extrapolateRight: "clamp" }), transform: `translateY(${interpolate(s, [0, 1], [700, 0])}px) scale(${sel && frame < 46 ? 1.06 : 1})` }}>
            <Card
              bg={sel ? C.sunnySoft : C.white}
              shadow={sel ? 12 : 7}
              style={{ width: 420, height: 560, padding: 26, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", outline: sel ? `6px solid ${C.sunny}` : "none", position: "relative", overflow: "hidden" }}
            >
              <div style={{ alignSelf: "stretch", display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 18, color: "#5b5566" }}>
                <span>P{i + 1}</span>
                <span>{j.role.toUpperCase()}</span>
              </div>
              <div style={{ position: "relative", marginTop: 6 }}>
                {chosen && techOn && (
                  <div style={{ position: "absolute", inset: -30, borderRadius: "50%", background: `radial-gradient(${C.oracle}55, transparent 65%)`, transform: `scale(${interpolate(power, [0, 1], [0.2, 1.15])})` }} />
                )}
                <Fighter project={j.fighter} pose={chosen && techOn ? "victory" : frame % 30 < 15 ? "idle" : "bob"} scale={14} />
                {chosen && techOn && <CodeVisor />}
              </div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 44, letterSpacing: "-0.02em", marginTop: 8 }}>{j.name}</div>
              <div style={{ fontFamily: mono, fontSize: 16, color: C.oracle, marginTop: 6 }}>{j.ens}</div>
              {chosen && techOn && (
                <div style={{ position: "absolute", top: 70, right: 14 }}>
                  <Sticker at={chipTap + 6} bg={C.oracle} color={C.white} rotate={8} size={26}>
                    TECH MODE
                  </Sticker>
                </div>
              )}
            </Card>
          </div>
        );
      })}

      {/* tuning panel */}
      <div style={{ position: "absolute", left: panelX, top: panelY, opacity: interpolate(tune, [0.3, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateX(${interpolate(tune, [0, 1], [700, 0])}px)` }}>
        <Card style={{ width: 990, height: 560, padding: 48, boxSizing: "border-box" }} shadow={12}>
          <div style={{ fontFamily: mono, fontSize: 22, color: "#5b5566" }}>PERSONA · Priya Raman · v2</div>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 46, letterSpacing: "-0.02em", marginTop: 14 }}>How strict?</div>
          <div style={{ position: "relative", height: 70, marginTop: 30, marginLeft: 12 }}>
            <div style={{ position: "absolute", top: 28, left: 0, width: SL, height: 14, borderRadius: 7, background: C.sunken, border: `3px solid ${C.ink}` }} />
            <div style={{ position: "absolute", top: 28, left: 0, width: (knob / 2) * SL, height: 14, borderRadius: 7, background: knob > 1.5 ? C.crush : C.oracle, border: `3px solid ${C.ink}` }} />
            {MODES.map((m, k) => (
              <div key={m.label} style={{ position: "absolute", top: 72, left: (k / 2) * SL - 60, width: 120, textAlign: "center", fontFamily: body, fontWeight: 700, fontSize: 24, color: mode.label === m.label ? C.ink : "#9a93a6" }}>
                {m.label}
              </div>
            ))}
            <div style={{ position: "absolute", top: 12, left: (knob / 2) * SL - 22, width: 44, height: 44, borderRadius: "50%", background: C.sunny, border: `4px solid ${C.ink}`, boxShadow: pop(4) }} />
          </div>
          <div style={{ marginTop: 64, fontFamily: body, fontWeight: 600, fontSize: 30, color: C.ink, background: knob > 1.5 ? C.crushSoft : C.oracleSoft, borderRadius: 12, padding: "12px 18px", display: "inline-block" }}>
            “{mode.hint}”
          </div>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 36, letterSpacing: "-0.02em", marginTop: 34 }}>Focus on</div>
          <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
            {CHIPS.map((c, k) => {
              const on = k === 0 && techOn;
              const pressed = k === 0 && frame >= chipTap && frame < chipTap + 5;
              return (
                <span
                  key={c}
                  style={{
                    fontFamily: body,
                    fontWeight: 700,
                    fontSize: 26,
                    padding: "12px 20px",
                    borderRadius: 999,
                    border: `3px solid ${C.ink}`,
                    background: on ? C.oracle : C.white,
                    color: on ? C.white : C.ink,
                    boxShadow: pressed ? "none" : pop(4),
                    transform: pressed ? "translate(3px,3px)" : on ? `scale(${interpolate(power, [0, 1], [1.25, 1])})` : "none",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {c}
                </span>
              );
            })}
          </div>
        </Card>
      </div>
      <Cursor x={cur.x} y={cur.y} tap={cur.tap} color={C.sunny} label="you" />
      <div style={{ position: "absolute", right: 120, bottom: 64 }}>
        <Sticker at={150} bg={C.crush} color={C.white} rotate={-4} size={38}>
          Brutal on the tech. One click.
        </Sticker>
      </div>
    </Paper>
  );
};

const useSpringLocal = (frame, at) => {
  const t = Math.max(0, frame - at) / 12;
  return t >= 1 ? 1 : 1 - Math.pow(1 - t, 3) * Math.cos(t * 3);
};

/** Green code lines streaming across the judge's eyes. */
const CodeVisor = () => {
  const frame = useCurrentFrame();
  const lines = ["fn verify()", "0x7a3f..", "assert!(ok)", "O(n log n)"];
  return (
    <div style={{ position: "absolute", left: 56, top: 74, width: 160, height: 30, background: C.ink, border: `3px solid ${C.oracle}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ fontFamily: mono, fontSize: 14, color: "#7CFFB2", whiteSpace: "nowrap", transform: `translateX(${-((frame * 4) % 300)}px)`, lineHeight: "24px", paddingLeft: 6 }}>
        {lines.join("  ·  ")} · {lines.join("  ·  ")}
      </div>
    </div>
  );
};
