/*
 * The ring. A pure renderer: (match, fight state, current event, elapsed ms)
 * -> pixels. Scene colours come from design tokens via CSS classes; fighter
 * colours come from fighter.js (sprite palette). Everything critical is also
 * text: health numbers, ruling words, captions, and a polite live region.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { fighterTraits, poseRects } from "../lib/fighter.js";
import { CRITERIA, CRITERION_LABEL, RULING_TEXT, WEIGHTS, fmtHealth, fmtScore } from "./score.js";
import { SCENE, choreograph, voteCount } from "./choreo.js";
import { scoreSoFar } from "./reducer.js";
import { MumbaiBackdrop } from "./MumbaiBackdrop.jsx";
import { MUMBAI_SCENES, sceneryForMatch, sceneryIdentity } from "./scenery.js";

const GY = SCENE.ground;
const OUTCOME_WORD = { hit: "Hit", graze: "Graze", block: "Block", clash: "Clash" };

/** Largest whole-number scale that fits the container (integer pixels only). `fit` also respects its height. */
function useIntegerScale(min = 2, max = 12, fit = false) {
  const ref = useRef(null);
  const [scale, setScale] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const byWidth = width / SCENE.w;
      setScale(Math.max(min, Math.min(max, Math.floor(fit && height > 0 ? Math.min(byWidth, height / SCENE.h) : byWidth))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, max, fit]);
  return [ref, scale];
}

const R = ({ x, y, w, h = 1, c, o }) => <rect x={x} y={y} width={w} height={h} className={c} opacity={o} />;

const Backdrop = memo(function Backdrop({ scene }) {
  return (
    <g>
      <MumbaiBackdrop scene={scene} />
      <R x={0} y={GY} w={SCENE.w} h={6} c="fs-canvas" /><R x={0} y={GY} w={SCENE.w} c="fs-ink" />
      <R x={0} y={54} w={SCENE.w} h={6} c="fs-apron" /><R x={0} y={54} w={SCENE.w} c="fs-ink" />
      {Array.from({ length: 18 }, (_, k) => <R key={k} x={k * 6} y={57} w={3} c="fs-canvas" />)}
      <R x={5} y={23} w={2} h={33} c="fs-ink" /><R x={4} y={22} w={2} h={33} c="fs-post-a" />
      <R x={103} y={23} w={2} h={33} c="fs-ink" /><R x={102} y={22} w={2} h={33} c="fs-post-b" />
      {[30, 36, 42].map((y) => (
        <g key={y}>
          <R x={6} y={y + 1} w={96} c="fs-ink" o={0.2} />
          <R x={6} y={y} w={96} c="fs-ink" />
        </g>
      ))}
    </g>
  );
});

function Fighter({ traits, pose, x, y, side, snap }) {
  const rects = useMemo(() => poseRects(traits, pose), [traits, pose]);
  const X = snap(x);
  const top = GY - 20 - snap(y);
  const transform = side === "a" ? `translate(${X} ${top})` : `translate(${X + 24} ${top}) scale(-1 1)`;
  return (
    <>
      <rect x={snap(x) + 6} y={GY + 1} width={12} height={1} className="fs-ink" opacity={0.18} />
      <g transform={transform}>
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      </g>
    </>
  );
}

/** A plus-shaped pixel star: ink outline, sunny body, milk core. */
function Star({ cx, cy, r, k = 1 }) {
  const arm = (rr, c) => (
    <g className={c}>
      <rect x={cx - rr} y={cy} width={rr * 2 + 1} height={1} />
      <rect x={cx} y={cy - rr} width={1} height={rr * 2 + 1} />
      <rect x={cx - 1} y={cy - 1} width={3} height={3} />
    </g>
  );
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`}>
      {arm(r + 1, "fs-ink")}
      <g className="fs-ink">
        <rect x={cx - 2} y={cy - 1} width={5} height={3} />
        <rect x={cx - 1} y={cy - 2} width={3} height={5} />
      </g>
      {arm(r, "fs-sun")}
      <rect x={cx} y={cy} width={1} height={1} className="fs-canvas" />
      {r > 3 && [[-3, -3], [3, -3], [-3, 3], [3, 3]].map(([dx, dy]) => <rect key={`${dx}${dy}`} x={cx + dx} y={cy + dy} width={1} height={1} className="fs-sun" />)}
    </g>
  );
}

function Effects({ fx, ruling, choreo }) {
  if (!fx.kind) return null;
  const vis = fx.t > 0 && fx.t < 1;
  const pop = 0.5 + 0.7 * Math.min(1, fx.t * 3) - 0.2 * Math.max(0, fx.t * 3 - 1) / 2;
  const fade = 1 - Math.max(0, (fx.t - 0.75) / 0.25);
  const cx = ruling?.attacker === "b" ? 50 : 58;
  if ((fx.kind === "hit" || fx.kind === "graze") && vis)
    return <g opacity={fade}><Star cx={cx} cy={40} r={fx.kind === "hit" ? 5 : 3} k={pop} /></g>;
  if (fx.kind === "block" && vis) {
    const sx = ruling?.attacker === "b" ? choreo.a.x + 19 : choreo.b.x + 3;
    return (
      <g opacity={fade}>
        <rect x={Math.round(sx) - 1} y={34} width={4} height={11} className="fs-ink" />
        <rect x={Math.round(sx)} y={35} width={2} height={9} className="fs-canvas" />
        {[[-3, 35], [4, 37], [-2, 43]].map(([dx, y]) => <rect key={dx} x={Math.round(sx) + dx} y={y} width={1} height={1} className="fs-post-a" />)}
      </g>
    );
  }
  if (fx.kind === "clash" && vis)
    return <g opacity={fade}><Star cx={54} cy={40} r={3} k={pop} /></g>;
  if (fx.kind === "penalty" && fx.t > 0) {
    const x = (choreo[fx.side]?.x ?? 50) + 10;
    const y = 18 - Math.round(3 * Math.min(1, fx.t));
    return (
      <g>
        <rect x={x - 1} y={y - 1} width={6} height={8} className="fs-ink" />
        <rect x={x} y={y} width={4} height={6} className="fs-sun" />
      </g>
    );
  }
  return null;
}

function HealthCard({ side, fighter, health, damage, float, align }) {
  const pct = (health / 100000) * 100;
  return (
    <div className={`fs-hp fs-hp--${side}`}>
      <div className="fs-hp__row">
        <span className={`fs-tag fs-tag--${side}`}>{side === "a" ? "Blue" : "Orange"}</span>
        <span className="fs-hp__name">{fighter.name}</span>
        <span className="fs-hp__num t-num">{fmtHealth(health)}</span>
      </div>
      <div className={`fs-bar fs-bar--${side}`} role="img" aria-label={`${fighter.name} health ${fmtHealth(health)} of 100, floor 20`}>
        <span className="fs-bar__fill" style={{ width: `${pct}%` }} />
        <span className="fs-bar__floor" />
      </div>
      {damage > 0 && float > 0 && float < 1 && (
        <span className="fs-dmg t-num" style={{ opacity: 1 - float * 0.9, transform: `translateY(${-14 * float}px)`, [align]: "12px" }}>
          −{fmtHealth(damage)}
        </span>
      )}
    </div>
  );
}

function RoundBadge({ state }) {
  const idx = state.round ? CRITERIA.indexOf(state.round) + 1 : 0;
  return (
    <div className="fs-round">
      <span className="fs-round__k">{idx ? `Round ${idx}/5` : state.phase === "pitches" ? "Pitches" : "Intro"}</span>
      <span className="fs-round__name">{state.round ? CRITERION_LABEL[state.round] : "Get ready"}</span>
      <span className="fs-round__pips" aria-label="Rounds">
        {CRITERIA.map((c) => (
          <span key={c} className={`fs-pip ${state.sealed.a[c] ? "is-sealed" : state.round === c ? "is-live" : ""}`} title={CRITERION_LABEL[c]}>
            {CRITERION_LABEL[c][0]}
          </span>
        ))}
      </span>
    </div>
  );
}

const name = (match, actor) => match.fighters[actor]?.name ?? (match.judges[actor] ? `Judge ${match.judges[actor].name}` : "");

export function captionFor(match, state, event) {
  if (!event) return { who: "", text: "" };
  const A = match.fighters.a.name, B = match.fighters.b.name;
  switch (event.type) {
    case "intro": return { who: "Announcer", text: `${A} vs ${B}. Three judges, six rounds. Only the judges' scores decide the fight.` };
    case "round_start": return { who: CRITERION_LABEL[event.round], text: `${CRITERION_LABEL[event.round]} round, worth ${WEIGHTS[event.round]}% of the score.` };
    case "ruling": {
      const r = state.rulings.find((x) => x.challengeId === event.challengeId);
      return { who: "Judges", text: `${RULING_TEXT[r?.label] ?? "Ruling"} ${voteCount(event.votes, r?.label)}. ${event.reason ?? ""}` };
    }
    case "penalty": return { who: `${name(match, event.judge)} · penalty on ${name(match, event.target)}`, text: event.reason };
    case "round_sealed": {
      const d = state.damage;
      return { who: "Scores sealed", text: `${CRITERION_LABEL[event.round]} sealed. ${A} −${fmtHealth(d?.a ?? 0)}, ${B} −${fmtHealth(d?.b ?? 0)} health.` };
    }
    case "human_review": return { who: "Organizer review", text: event.status === "pending" ? "Second tie. Awaiting organizer decision; advancement and settlement are paused." : event.rationale };
    case "result": {
      const w = state.result?.winner;
      const sa = scoreSoFar(state, "a"), sb = scoreSoFar(state, "b");
      const why = state.result?.reason === "tie_break" ? "the tie-break score" : state.result?.reason === "organizer" ? "organizer decision after two ties" : "the higher final score";
      return { who: "Result", text: w ? `${match.fighters[w].name} wins on ${why}: ${fmtScore(sa)} to ${fmtScore(sb)}.` : "" };
    }
    default: return { who: name(match, event.actor), text: event.text ?? "" };
  }
}

export function FightStage({ match, state, event, ms, reduced = false, captions = true, typing = true, fit = false }) {
  const [wrap, scale] = useIntegerScale(2, fit ? 24 : 12, fit);
  const traits = useMemo(() => ({ a: fighterTraits(match.fighters.a), b: fighterTraits(match.fighters.b) }), [match]);
  const [sceneChoice, setSceneChoice] = useState(null);
  const sceneKey = sceneryIdentity(match);
  const scenery = sceneChoice?.key === sceneKey ? sceneChoice.scene : sceneryForMatch(match);
  const c = choreograph(event, ms, state, { reduced });
  const snap = (v) => Math.round(v * scale) / scale; // move in screen pixels, stay on the pixel grid
  const ruling = event?.type === "ruling" ? state.rulings.find((r) => r.challengeId === event.challengeId) : null;
  const challenge = event?.type === "challenge" ? event : ruling ? state.challenges[event.challengeId] : null;
  const shakeX = c.shake ? snap(Math.sin(ms / 16) * 1.5 * c.shake) : 0;
  const cap = captionFor(match, state, event);
  const reveal = reduced || !typing || !cap.text ? cap.text : cap.text.slice(0, Math.ceil(cap.text.length * Math.min(1, c.t * 1.7)));
  const w = SCENE.w * scale, h = SCENE.h * scale;
  const showResult = state.result && event?.type === "result";
  const review = state.review?.status === "pending";

  return (
    <div ref={wrap} className={`fs-wrap ${fit ? "fs-wrap--fit" : ""}`}>
      <div className="fs" style={{ width: w, height: h }}>
        <svg className="fs__scene" viewBox={`0 0 ${SCENE.w} ${SCENE.h}`} width={w} height={h} shapeRendering="crispEdges" aria-hidden="true">
          <g transform={`translate(${shakeX} 0)`}>
            <Backdrop scene={scenery.id} />
            <Fighter traits={traits.a} side="a" snap={snap} {...c.a} />
            <Fighter traits={traits.b} side="b" snap={snap} {...c.b} />
            <Effects fx={c.fx} ruling={ruling} choreo={c} />
          </g>
        </svg>

        <div className="fs__hud">
          <HealthCard side="a" fighter={match.fighters.a} health={state.health.a} damage={state.damage?.a} float={c.fx.float} align="left" />
          <RoundBadge state={state} />
          <HealthCard side="b" fighter={match.fighters.b} health={state.health.b} damage={state.damage?.b} float={c.fx.float} align="right" />
        </div>

        {challenge?.move && (c.fx.kind === "callout" || ruling) && (
          <div className="fs__callout" style={{ opacity: Math.min(1, (c.fx.kind === "callout" ? c.fx.t : 1) * 1.2), transform: `rotate(-2deg) scale(${0.85 + 0.15 * Math.min(1, c.fx.kind === "callout" ? c.fx.t : 1)})` }}>
            {challenge.move}
          </div>
        )}
        {ruling && c.fx.stamp > 0 && (
          <div className={`fs__stamp fs__stamp--${c.fx.kind}`} style={{ opacity: Math.min(1, c.fx.stamp * 2), transform: `rotate(6deg) scale(${1.6 - 0.6 * c.fx.stamp})` }}>
            <span className="fs__stamp-word">{OUTCOME_WORD[c.fx.kind]}</span>
            <span className="fs__stamp-sub">{RULING_TEXT[ruling.label]} · {voteCount(ruling.votes, ruling.label)}</span>
          </div>
        )}
        {event?.type === "round_sealed" && c.fx.t > 0 && (
          <div className="fs__banner" style={{ opacity: Math.min(1, c.fx.t * 2) }}>
            {CRITERION_LABEL[event.round]} sealed
          </div>
        )}
        {showResult && (
          <div className="fs__banner fs__banner--result" style={{ opacity: Math.min(1, c.fx.t * 2) }}>
            {match.fighters[state.result.winner].name} wins
          </div>
        )}
        {review && <div className="fs__banner fs__banner--review">Awaiting organizer decision</div>}

        {captions && cap.text && (
          <div className="fs__caption">
            <span className="fs__cc" aria-hidden="true">CC</span>
            <span>
              {cap.who && <b className="fs__who">{cap.who}: </b>}
              {reveal}
              {challenge?.evidence && event.type === "challenge" && (
                <span className="fs__evidence">
                  {challenge.evidence.map((e) => (
                    <span key={e.label} className="fs__chip">{e.label}</span>
                  ))}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      {!fit && <div className="fs-locations">
        <span className="t-label fs-locations__heading">Stage</span>
        <div className="fs-locations__options" role="group" aria-label="Stage">
          {MUMBAI_SCENES.map((scene) => (
            <button key={scene.id} type="button" aria-pressed={scenery.id === scene.id} title={scene.detail} onClick={() => setSceneChoice({ key: sceneKey, scene })}>
              <span className="fs-locations__swatch" style={{ background: scene.color }} aria-hidden="true" />
              {scene.name}
            </button>
          ))}
        </div>
      </div>}
      <p className="sr-only" aria-live="polite">{cap.who ? `${cap.who}: ${cap.text}` : cap.text}</p>
    </div>
  );
}
