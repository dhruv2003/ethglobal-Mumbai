import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, random, Easing } from "remotion";
import { C, Paper, Headline, Card, Sticker, Fighter, display, mono, body, pop, shake, useSpring, clamp, lerp } from "../theme.jsx";
import { FIGHTER_A } from "../cast.js";

/* 0:00–0:13 — the team's skit, framed in the brand. */
export const Skit = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <OffthreadVideo src={staticFile("skit.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ boxShadow: `inset 0 0 0 10px ${C.ink}`, pointerEvents: "none" }} />
      <Grain />
      {/* tiny REC-style tag so it reads as "the old way" */}
      <div
        style={{
          position: "absolute",
          left: 40,
          bottom: 36,
          fontFamily: mono,
          fontSize: 22,
          color: C.white,
          background: "rgba(23,20,31,0.75)",
          padding: "6px 12px",
          borderRadius: 8,
          opacity: frame < 315 ? 1 : 0,
        }}
      >
        ● judging, the old way
      </div>
    </AbsoluteFill>
  );
};

const Grain = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: 0.08,
        mixBlendMode: "overlay",
        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' seed='${frame % 8}'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")`,
      }}
    />
  );
};

/* 0:13–0:17 — question, then logo slam. */
export const Reveal = () => {
  const frame = useCurrentFrame();
  const slamAt = 38;
  const s = useSpring(slamAt, { damping: 9, stiffness: 220, mass: 0.6 });
  const sh = shake(frame, slamAt + 3, 26, 12);
  const pixels = new Array(70).fill(0).map((_, i) => {
    const a = random(`a${i}`) * Math.PI * 2;
    const d = (frame - slamAt) * (14 + random(`d${i}`) * 26);
    const col = [C.sunny, C.crush, C.oracle, C.white][i % 4];
    return { x: 960 + Math.cos(a) * d, y: 540 + Math.sin(a) * d, col, size: 18 + random(`s${i}`) * 26 };
  });
  return (
    <AbsoluteFill>
      {frame < slamAt ? (
        <Paper color={C.ink} dot="rgba(255,255,255,0.06)">
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
            <Headline words={["She", "didn't", "judge", "it."]} size={140} color={C.white} highlight={{ 1: C.crush }} />
            <div style={{ height: 24 }} />
            <Headline words={["So", "who", "did?"]} at={14} size={140} color={C.sunny} />
          </AbsoluteFill>
        </Paper>
      ) : (
        <Paper color={C.sunny} dot="rgba(23,20,31,0.10)">
          {frame - slamAt < 3 && <AbsoluteFill style={{ background: C.white }} />}
          {frame - slamAt < 26 &&
            pixels.map((p, i) => (
              <div key={i} style={{ position: "absolute", left: p.x, top: p.y, width: p.size, height: p.size, background: p.col, border: `3px solid ${C.ink}` }} />
            ))}
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", transform: `translate(${sh.x}px, ${sh.y}px)` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 48, transform: `scale(${interpolate(s, [0, 1], [3.2, 1], clamp)})`, opacity: interpolate(s, [0, 0.15], [0, 1], clamp) }}>
              <Img src={staticFile("logo.svg")} style={{ width: 300, height: 300, borderRadius: 64, border: `5px solid ${C.ink}`, boxShadow: pop(14) }} />
              <div>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 210, letterSpacing: "-0.05em", lineHeight: 0.85, color: C.ink }}>
                  Fight<span style={{ color: C.crushInk }}>Club</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 56 }}>
              <Headline words={["Every", "project.", "Judged.", "Like", "a", "fight."]} at={slamAt + 22} size={64} stagger={3} highlight={{ 5: C.white }} />
            </div>
          </AbsoluteFill>
        </Paper>
      )}
    </AbsoluteFill>
  );
};

/* 0:17–0:20 — submit a repo, become a fighter. */
export const Submit = () => {
  const frame = useCurrentFrame();
  const url = "github.com/team/zk-vote";
  const typed = url.slice(0, Math.floor(lerp(frame, 4, 26, 0, url.length)));
  const pressAt = 32;
  const pressed = frame >= pressAt && frame < pressAt + 5;
  const flip = lerp(frame, 38, 52, 0, 180, Easing.inOut(Easing.cubic));
  const enter = useSpring(0);
  return (
    <Paper>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 130px", gap: 110 }}>
        <div style={{ flex: 1 }}>
          <Headline words={["Submit."]} size={130} />
          <Headline words={["Become", "a", "fighter."]} at={8} size={130} highlight={{ 2: C.sunny }} />
        </div>
        <div style={{ width: 640, height: 640, perspective: 1600, transform: `translateY(${interpolate(enter, [0, 1], [300, 0])}px)` }}>
          <div style={{ width: "100%", height: "100%", position: "relative", transformStyle: "preserve-3d", transform: `rotateY(${flip}deg)` }}>
            {/* front: the submit form */}
            <Card style={{ position: "absolute", inset: 0, padding: 48, backfaceVisibility: "hidden", display: "flex", flexDirection: "column", gap: 26 }} shadow={14}>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 52, letterSpacing: "-0.02em" }}>Submit project</div>
              <Label>GitHub repo</Label>
              <Field>
                {typed}
                {frame < 30 && frame % 16 < 8 && <span style={{ color: C.oracle }}>|</span>}
              </Field>
              <Label>Demo video · photos · pitch deck</Label>
              <Field muted>demo.mp4 · 3 images · deck.pdf</Field>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  background: C.oracle,
                  color: C.white,
                  fontFamily: display,
                  fontWeight: 800,
                  fontSize: 40,
                  textAlign: "center",
                  padding: "22px 0",
                  borderRadius: 16,
                  border: `3px solid ${C.ink}`,
                  boxShadow: pressed ? pop(2) : pop(7),
                  transform: pressed ? "translate(4px, 4px)" : "none",
                }}
              >
                Enter the arena →
              </div>
            </Card>
            {/* back: the fighter */}
            <Card
              bg={C.oracle}
              shadow={14}
              style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
            >
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.18) 2px, transparent 2.5px)", backgroundSize: "24px 24px" }} />
              <Fighter project={FIGHTER_A} pose={frame > 60 ? "victory" : "idle"} scale={20} />
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 64, color: C.white, marginTop: -10, letterSpacing: "-0.02em" }}>ZK Vote</div>
            </Card>
          </div>
          <div style={{ position: "absolute", left: 40, bottom: -36, transform: "translateZ(0)" }}>
            <Sticker at={56} font={mono} size={34} bg={C.sunny} rotate={-5}>
              zkvote.fightclub.eth
            </Sticker>
          </div>
        </div>
      </AbsoluteFill>
    </Paper>
  );
};

const Label = ({ children }) => <div style={{ fontFamily: body, fontWeight: 700, fontSize: 24, color: "#5b5566", marginBottom: -12 }}>{children}</div>;
const Field = ({ children, muted }) => (
  <div
    style={{
      fontFamily: mono,
      fontSize: 30,
      padding: "18px 22px",
      border: `3px solid ${C.ink}`,
      borderRadius: 14,
      background: muted ? C.sunken : C.paper,
      color: muted ? "#5b5566" : C.ink,
      minHeight: 40,
    }}
  >
    {children}
  </div>
);
