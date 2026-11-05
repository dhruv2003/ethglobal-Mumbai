import { useEffect, useRef, useState } from "react";
import { Progress } from "@ds/ui.jsx";
import { fighterTraits } from "../lib/fighter.js";
import { Ring } from "./Arena.jsx";
import { useForm } from "./fields.jsx";
import { fighterTraitItems, PixelFighter } from "./PixelFighter.jsx";
import { trackName } from "./Projects.jsx";

const REQUIRED = ["team.name", "project.name", "project.pitch", "project.description", "code.repoUrl", "demo.videoUrl"];

/**
 * Live preview: the fighter rebuilds as the team types. Gear earned from the
 * description pops on, and a short "new gear" note says why.
 */
export function FighterPreview() {
  const { data, errors } = useForm();
  const project = {
    seed: data.fighter?.seed,
    name: data.project.name.trim() || "Unnamed project",
    pitch: data.project.pitch,
    description: data.project.description,
    tracks: data.tracks.selected,
  };
  const gearIds = Object.values(fighterTraits(project).gear).map((g) => g.id);
  const items = fighterTraitItems(project, trackName);

  const prev = useRef(gearIds);
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    const added = gearIds.find((id) => !prev.current.includes(id));
    prev.current = gearIds;
    if (!added) return undefined;
    setFresh(items.find((i) => i.id === added)?.label ?? null);
    const t = setTimeout(() => setFresh(null), 2400);
    return () => clearTimeout(t);
    // gearIds is derived from data; join keeps the effect cheap and stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gearIds.join("|")]);

  const ready = REQUIRED.filter((k) => !errors[k]).length;

  return (
    <aside className="preview" aria-label="Your fighter preview">
      <Ring className="preview__ring">
        {fresh && (
          <span className="gear-note" role="status">
            New gear: {fresh}
          </span>
        )}
        <PixelFighter project={project} scale={9} />
      </Ring>
      <div className="preview__body">
        <div>
          <span className="t-label">Your fighter</span>
          <h2 className="t-display-md m0 preview__name">{project.name}</h2>
        </div>
        <ul className="traits">
          {items.map((i) => (
            <li key={i.id} className="trait trait--pop">
              <span className="t-body-strong">{i.label}</span>
              <span className="t-caption">{i.why}</span>
            </li>
          ))}
        </ul>
        <p className="t-caption m0">Mention what you built in the description. Wearables, AI agents, payments, games, audio and privacy each earn gear.</p>
        <div className="stack-xs">
          <span className="t-caption t-num">
            {ready} of {REQUIRED.length} fields ready
          </span>
          <Progress value={ready} max={REQUIRED.length} label="Fields ready" />
        </div>
      </div>
    </aside>
  );
}
