import { AbsoluteFill, Composition, Sequence, Audio, staticFile, registerRoot, interpolate, useCurrentFrame } from "remotion";
import T from "./timing.json";
import { C } from "./theme.jsx";
import { Skit, Reveal, Submit } from "./scenes/Intro.jsx";
import { Devices } from "./scenes/Agents.jsx";
import { AgentsArena as Agents } from "./scenes/AgentsArena.jsx";
import { Judges } from "./scenes/Judges.jsx";
import { Fight } from "./scenes/Fight.jsx";
import { Bet, Close } from "./scenes/Outro.jsx";

const SCENES = { skit: Skit, reveal: Reveal, submit: Submit, agents: Agents, devices: Devices, judges: Judges, fight: Fight, bet: Bet, close: Close };

/** Three brand-colour bars sweep across the cut. */
const Wipe = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {[C.sunny, C.crush, C.oracle].map((col, i) => {
        const x = interpolate(frame, [i * 1.5, 8 + i * 1.5, 16 + i * 1.5], [-2600, -300, 2400]);
        return <div key={i} style={{ position: "absolute", top: -400, left: x, width: 900, height: 1900, background: col, borderLeft: `6px solid ${C.ink}`, borderRight: `6px solid ${C.ink}`, transform: "rotate(18deg)" }} />;
      })}
    </AbsoluteFill>
  );
};

const Video = () => (
  <AbsoluteFill style={{ background: C.ink }}>
    {Object.entries(T.scenes).map(([k, [from, dur]]) => {
      const S = SCENES[k];
      return (
        <Sequence key={k} from={from} durationInFrames={dur} name={k}>
          <S />
        </Sequence>
      );
    })}
    {Object.entries(T.scenes)
      .filter(([k]) => !["skit", "reveal", "fight", "close"].includes(k))
      .map(([k, [from]]) => (
        <Sequence key={`w-${k}`} from={from - 8} durationInFrames={20} name={`wipe-${k}`}>
          <Wipe />
        </Sequence>
      ))}
    <Sequence from={T.scenes.reveal[0]} name="music">
      <Audio src={staticFile("music.wav")} />
    </Sequence>
  </AbsoluteFill>
);

const Root = () => <Composition id="FightClub" component={Video} durationInFrames={T.total} fps={T.fps} width={1920} height={1080} />;

registerRoot(Root);
