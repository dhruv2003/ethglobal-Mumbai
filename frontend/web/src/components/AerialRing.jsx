/*
 * A wrestling ring seen from above, drawn in 8-bit pixels. The crowd twinkles,
 * the two fighters circle, lunge and trade sparks while a match is live.
 * All motion is CSS with steps(), so it snaps like old hardware, and it stops
 * under prefers-reduced-motion. Decorative: the card around it carries the words.
 */
import { memo, useMemo } from "react";
import { fighterTraits, poseRects } from "../lib/fighter.js";

const W = 96;
const H = 72;
const MAT = { x: 20, y: 14, w: 56, h: 44 };

function Sprite({ traits, flip, down }) {
  const pixels = useMemo(() => poseRects(traits, down ? "defeat" : "idle"), [traits, down]);
  return (
    <g className="aer-sprite">
      <g transform={flip ? "translate(15 -4) scale(-0.8 0.8)" : "translate(-3 -4) scale(0.8)"}>
        {pixels.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />)}
      </g>
    </g>
  );
}

const random = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const Crowd = memo(function Crowd({ seed }) {
  const seats = useMemo(() => {
    const list = [];
    for (let y = 1; y < H - 1; y += 3) {
      for (let x = 1; x < W - 1; x += 3) {
        const inRing = x > MAT.x - 8 && x < MAT.x + MAT.w + 6 && y > MAT.y - 7 && y < MAT.y + MAT.h + 5;
        if (inRing) continue;
        const r = random(seed + x * 13 + y * 7);
        if (r < 0.2) continue;
        list.push({ x, y, tone: Math.floor(r * 100) % 5, group: Math.floor(r * 1000) % 3 });
      }
    }
    return list;
  }, [seed]);
  return (
    <g className="aer-crowd">
      {seats.map((s) => (
        <rect key={`${s.x}-${s.y}`} className={`aer-seat aer-seat--${s.tone} aer-wave--${s.group}`} x={s.x} y={s.y} width="2" height="2" />
      ))}
    </g>
  );
});

function Ring() {
  const { x, y, w, h } = MAT;
  const posts = [
    [x - 3, y - 3],
    [x + w - 1, y - 3],
    [x - 3, y + h - 1],
    [x + w - 1, y + h - 1],
  ];
  return (
    <g>
      <rect className="aer-apron" x={x - 5} y={y - 5} width={w + 10} height={h + 10} />
      <rect className="aer-mat" x={x} y={y} width={w} height={h} />
      <rect className="aer-mat-line" x={x + 4} y={y + 4} width={w - 8} height="1" />
      <rect className="aer-mat-line" x={x + 4} y={y + h - 5} width={w - 8} height="1" />
      <rect className="aer-mat-line" x={x + 4} y={y + 4} width="1" height={h - 8} />
      <rect className="aer-mat-line" x={x + w - 5} y={y + 4} width="1" height={h - 8} />
      <rect className="aer-mark" x={x + w / 2 - 6} y={y + h / 2 - 2} width="12" height="4" />
      <rect className="aer-mark" x={x + w / 2 - 4} y={y + h / 2 - 4} width="8" height="8" />
      <rect className="aer-mark" x={x + w / 2 - 2} y={y + h / 2 - 6} width="4" height="12" />
      {[-2, 0].map((o) => (
        <g key={o}>
          <rect className="aer-rope aer-rope--a" x={x} y={y + o - 1} width={w} height="1" />
          <rect className="aer-rope aer-rope--b" x={x} y={y + h - o} width={w} height="1" />
          <rect className="aer-rope aer-rope--a" x={x + o - 1} y={y} width="1" height={h} />
          <rect className="aer-rope aer-rope--b" x={x + w - o} y={y} width="1" height={h} />
        </g>
      ))}
      {posts.map(([px, py]) => (
        <g key={`${px}-${py}`}>
          <rect className="aer-post" x={px} y={py} width="4" height="4" />
          <rect className="aer-post-top" x={px + 1} y={py + 1} width="2" height="2" />
        </g>
      ))}
    </g>
  );
}

const Spark = ({ x, y, className = "" }) => (
  <g className={`aer-spark ${className}`} transform={`translate(${x} ${y})`}>
    <rect x="-1" y="-3" width="2" height="6" />
    <rect x="-3" y="-1" width="6" height="2" />
    <rect className="aer-spark__core" x="-1" y="-1" width="2" height="2" />
  </g>
);

/** status: scheduled | live | review | finalized | void. winner: "a" | "b" | null. */
export const AerialRing = memo(function AerialRing({ a, b, status, winner, seed = 1, label, compact = false }) {
  const traitsA = useMemo(() => fighterTraits(a), [a]);
  const traitsB = useMemo(() => fighterTraits(b), [b]);
  const style = { "--aer-d": `${4.4 + (seed % 5) * 0.5}s`, "--aer-delay": `-${(seed * 0.73) % 4}s` };
  const decided = status === "finalized" && winner;
  const aDown = decided && winner !== "a";
  const bDown = decided && winner !== "b";
  return (
    <svg className={`aer aer--${status} ${compact ? "aer--compact" : ""}`} viewBox={compact ? "8 2 80 66" : `0 6 ${W} ${H - 12}`} shapeRendering="crispEdges" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} style={style}>
      {!compact && <rect className="aer-floor" width={W} height={H} />}
      {(!compact || status === "live" || status === "review") && <Crowd seed={seed} />}
      <Ring />
      <g className={`aer-f aer-f--a ${decided ? (aDown ? "is-down" : "is-win") : ""}`}>
        <Sprite traits={traitsA} down={aDown} />
      </g>
      <g className={`aer-f aer-f--b ${decided ? (bDown ? "is-down" : "is-win") : ""}`}>
        <Sprite traits={traitsB} flip down={bDown} />
      </g>
      {status === "live" && (
        <>
          <Spark x="48" y="32" className="aer-spark--one" />
          <Spark x="48" y="39" className="aer-spark--two" />
        </>
      )}
      {status === "review" && (
        <g className="aer-question" transform="translate(45 24)">
          <rect x="1" y="0" width="5" height="2" />
          <rect x="5" y="2" width="2" height="3" />
          <rect x="3" y="5" width="2" height="3" />
          <rect x="3" y="10" width="2" height="2" />
        </g>
      )}
      {decided && (
        <g className="aer-bits">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} className={`aer-bit aer-bit--${i % 3}`} x={24 + i * 7} y="16" width="2" height="2" style={{ animationDelay: `${i * -0.27}s` }} />
          ))}
        </g>
      )}
    </svg>
  );
});
