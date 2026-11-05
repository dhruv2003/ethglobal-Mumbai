import { useMemo } from "react";
import { fighterLayers, fighterTraits } from "../lib/fighter.js";

const Rects = ({ rects }) => rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />);

/**
 * Animated 8-bit fighter for a project. Idle loop: the upper body bobs one
 * pixel, eyes blink, gear glints. Each project gets its own phase so a grid
 * of fighters doesn't move in lockstep. Reduced motion freezes it (components.css).
 */
export function PixelFighter({ project, scale = 6, className = "" }) {
  const traits = useMemo(() => fighterTraits(project), [project]);
  const layers = useMemo(() => fighterLayers(traits), [traits]);
  const phase = { "--fighter-delay": `-${(traits.seed % 900) / 1000}s`, "--blink-delay": `-${(traits.seed % 4000) / 1000}s` };
  return (
    <svg
      className={`fighter ${className}`}
      viewBox="0 -1 16 21"
      width={16 * scale}
      height={21 * scale}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`${project.name}'s fighter`}
      style={phase}
    >
      <ellipse className="fighter__shadow" cx="8" cy="19.6" rx="5" ry="0.7" />
      <g className="fighter__legs">
        <Rects rects={layers.legs} />
      </g>
      <g className="fighter__upper">
        <Rects rects={layers.upper} />
        <g className="fighter__eyes-open">
          <Rects rects={layers.eyesOpen} />
        </g>
        <g className="fighter__eyes-closed">
          <Rects rects={layers.eyesClosed} />
        </g>
        <Rects rects={layers.gear} />
        <g className="fighter__glint">
          <Rects rects={layers.glints} />
        </g>
      </g>
    </svg>
  );
}

/** Why the fighter looks the way it does, in words (never colour alone). */
export function FighterTraits({ project, trackName }) {
  const t = fighterTraits(project);
  const items = [
    t.jacketFrom ? { label: "Jacket colour", why: `first track: ${trackName(t.jacketFrom)}` } : { label: "Grey jacket", why: "no sponsor track" },
    ...Object.values(t.gear).map((g) => ({ label: g.label, why: g.why })),
  ];
  return (
    <ul className="traits">
      {items.map((i) => (
        <li key={i.label}>
          <span className="t-body-strong">{i.label}</span>
          <span className="t-caption">{i.why}</span>
        </li>
      ))}
    </ul>
  );
}
