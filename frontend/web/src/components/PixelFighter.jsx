import { useMemo } from "react";
import { fighterLayers, fighterTraits } from "../lib/fighter.js";

const Rects = ({ rects }) => rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />);

/**
 * Animated 8-bit fighter for a project. Idle loop: the upper body bobs one
 * pixel, eyes blink, gear glints. Gear pieces are keyed by id, so a newly
 * earned piece mounts fresh and pops in. Each project gets its own phase so a
 * grid of fighters never moves in lockstep. Reduced motion freezes it all.
 *
 * ghost: an empty silhouette, used for "your fighter here".
 */
export function PixelFighter({ project, scale = 6, className = "", ghost = false, label }) {
  const traits = useMemo(() => fighterTraits(project), [project]);
  const layers = useMemo(() => fighterLayers(traits), [traits]);
  const phase = {
    "--fighter-delay": `-${(traits.seed % 900) / 1000}s`,
    "--blink-delay": `-${(traits.seed % 4000) / 1000}s`,
  };
  return (
    <svg
      className={`fighter ${ghost ? "fighter--ghost" : ""} ${className}`}
      viewBox="0 -1 16 21"
      width={16 * scale}
      height={21 * scale}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? `${project.name}'s fighter: ${traits.archetypeName}`}
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
        {!ghost &&
          Object.entries(layers.gearById).map(([id, rects]) => (
            <g key={id} className="fighter__gear">
              <Rects rects={rects} />
            </g>
          ))}
        <g className="fighter__glint">{!ghost && <Rects rects={layers.glints} />}</g>
      </g>
    </svg>
  );
}

/** Why the fighter looks the way it does, in words (never colour alone). */
export function fighterTraitItems(project, trackName) {
  const t = fighterTraits(project);
  return [
    { id: "archetype", label: t.archetypeName, why: t.archetypeDetail },
    t.jacketFrom
      ? { id: "jacket", label: `${trackName(t.jacketFrom)} trim`, why: "first sponsor track" }
      : { id: "jacket", label: "Grey trim", why: "no sponsor track yet" },
    ...Object.values(t.gear).map((g) => ({ id: g.id, label: g.label, why: g.why })),
  ];
}
