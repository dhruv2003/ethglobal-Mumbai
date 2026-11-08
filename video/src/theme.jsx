import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque";
import { loadFont as loadBody } from "@remotion/google-fonts/Figtree";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, random } from "remotion";
import { useMemo } from "react";
import { fighterTraits, poseRects, POSE_CELL } from "./lib/fighter.js";

export const display = loadDisplay("normal", { weights: ["700", "800"] }).fontFamily;
export const body = loadBody("normal", { weights: ["500", "600", "700"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["500"] }).fontFamily;

export const C = {
  paper: "#F7F2EA",
  sunken: "#EDE6DA",
  ink: "#17141F",
  oracle: "#2F4BF0",
  oracleSoft: "#E8ECFF",
  crush: "#FF5C93",
  crushInk: "#C2185B",
  crushSoft: "#FFE3EC",
  sunny: "#FFD43B",
  sunnySoft: "#FFF4C7",
  amber: "#C98500",
  mint: "#1FA971",
  white: "#FFFFFF",
};

export const pop = (n = 8) => `${n}px ${n}px 0 ${C.ink}`;

export const useSpring = (delay = 0, config = { damping: 12, stiffness: 180, mass: 0.6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
};

/** Paper background with a slowly drifting halftone dot field. */
export const Paper = ({ color = C.paper, dot = "rgba(23,20,31,0.07)", children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: color }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${dot} 2px, transparent 2.5px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: `${frame * 0.4}px ${frame * 0.25}px`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

export const Card = ({ style, children, shadow = 8, bg = C.white }) => (
  <div style={{ background: bg, border: `3px solid ${C.ink}`, borderRadius: 22, boxShadow: pop(shadow), ...style }}>{children}</div>
);

/** Rubber-stamp sticker that slams in at `at`. */
export const Sticker = ({ at = 0, children, bg = C.sunny, color = C.ink, rotate = -6, style, size = 34, font = display }) => {
  const s = useSpring(at, { damping: 10, stiffness: 260, mass: 0.5 });
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <div
      style={{
        display: "inline-block",
        background: bg,
        color,
        border: `3px solid ${C.ink}`,
        borderRadius: 14,
        boxShadow: pop(6),
        padding: "10px 20px",
        fontFamily: font,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: font === display ? "-0.02em" : 0,
        transform: `scale(${interpolate(s, [0, 1], [2.4, 1])}) rotate(${rotate}deg)`,
        opacity: interpolate(s, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Big kinetic headline: each word springs up in turn. */
export const Headline = ({ words, at = 0, size = 96, color = C.ink, highlight = {}, stagger = 4, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ fontFamily: display, fontWeight: 800, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.035em", color, ...style }}>
      {words.map((w, i) => {
        const s = spring({ frame: frame - at - i * stagger, fps, config: { damping: 11, stiffness: 200, mass: 0.5 } });
        const hl = highlight[i];
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: "0.22em",
              transform: `translateY(${interpolate(s, [0, 1], [70, 0])}px) rotate(${interpolate(s, [0, 1], [8, 0])}deg)`,
              opacity: interpolate(s, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }),
              position: "relative",
            }}
          >
            {hl && (
              <span
                style={{
                  position: "absolute",
                  left: -8,
                  right: -8,
                  bottom: "0.06em",
                  height: "0.42em",
                  background: hl,
                  zIndex: -1,
                  borderRadius: 6,
                  transformOrigin: "left",
                  transform: `scaleX(${interpolate(frame - at - i * stagger, [6, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`,
                }}
              />
            )}
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Giant stroked number/word, the product's "kickoff" style. */
export const Kickoff = ({ children, size = 260, color = C.white, glow = "rgba(255,212,59,0.55)" }) => (
  <div
    style={{
      fontFamily: display,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 0.9,
      color,
      WebkitTextStroke: `${Math.round(size / 45)}px ${C.ink}`,
      textShadow: `0 ${Math.round(size / 22)}px 0 ${C.ink}, 0 0 80px ${glow}`,
      letterSpacing: "-0.03em",
    }}
  >
    {children}
  </div>
);

/** The product's pixel fighter, posed. */
export const Fighter = ({ project, pose = "idle", scale = 10, flip = false, style }) => {
  const t = useMemo(() => fighterTraits(project), [project]);
  const rects = useMemo(() => poseRects(t, pose), [t, pose]);
  return (
    <svg
      viewBox={`0 0 ${POSE_CELL.w} ${POSE_CELL.h + 1}`}
      width={POSE_CELL.w * scale}
      height={(POSE_CELL.h + 1) * scale}
      shapeRendering="crispEdges"
      style={{ transform: flip ? "scaleX(-1)" : undefined, overflow: "visible", ...style }}
    >
      <ellipse cx={POSE_CELL.bodyX + 8} cy={POSE_CELL.h - 0.3} rx="5.5" ry="0.8" fill="rgba(23,20,31,0.18)" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
};

export const shake = (frame, at, amount = 18, len = 10) => {
  const d = frame - at;
  if (d < 0 || d > len) return { x: 0, y: 0 };
  const k = 1 - d / len;
  return { x: (random(`sx${at}${d}`) - 0.5) * 2 * amount * k, y: (random(`sy${at}${d}`) - 0.5) * 2 * amount * k };
};

/** Animated agent cursor with a tap ripple. */
export const Cursor = ({ x, y, tap, color = C.crush, label = "AI" }) => {
  const frame = useCurrentFrame();
  const d = tap == null ? 99 : frame - tap;
  const press = d >= 0 && d < 6 ? 0.82 : 1;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: `scale(${press})`, transformOrigin: "0 0", zIndex: 50 }}>
      {d >= 0 && d < 18 && (
        <div
          style={{
            position: "absolute",
            left: -d * 2.4,
            top: -d * 2.4,
            width: d * 4.8,
            height: d * 4.8,
            borderRadius: "50%",
            border: `3px solid ${color}`,
            opacity: 1 - d / 18,
          }}
        />
      )}
      <svg width="34" height="40" viewBox="0 0 34 40" style={{ filter: `drop-shadow(3px 3px 0 ${C.ink})` }}>
        <path d="M2 2 L2 32 L10 25 L16 38 L22 35 L16 23 L28 23 Z" fill={color} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
      </svg>
      {label && (
        <span
          style={{
            position: "absolute",
            left: 26,
            top: 30,
            background: C.ink,
            color: C.white,
            fontFamily: mono,
            fontSize: 14,
            padding: "2px 6px",
            borderRadius: 6,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
export const lerp = (frame, a, b, c, d, ease) => interpolate(frame, [a, b], [c, d], { ...clamp, easing: ease });
