import { StatusPill } from "@ds/ui.jsx";
import { Msg, TextField, useForm } from "../components/fields.jsx";
import { EVENT } from "../config/event.js";

export function TracksSection() {
  const { data, set, errors, showAll } = useForm();
  const selected = data.tracks.selected;
  const full = selected.length >= EVENT.maxTracks;

  const toggle = (id) => {
    if (selected.includes(id)) set("tracks.selected", selected.filter((x) => x !== id));
    else if (!full) set("tracks.selected", [...selected, id]);
  };

  return (
    <section id="tracks" className="card sec" aria-labelledby="tracks-h">
      <div className="sec__head">
        <h2 id="tracks-h" className="t-display-md">Tracks</h2>
        <StatusPill tone="neutral">
          {selected.length} of {EVENT.maxTracks} picked
        </StatusPill>
      </div>
      <p className="t-body m0">
        You're always in the running for finalist. You can also enter up to {EVENT.maxTracks} sponsor tracks, or none.
      </p>

      <div className="chips" role="group" aria-label="Sponsor tracks" aria-describedby="f-tracks-selected-msg">
        {EVENT.tracks.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className="chip"
              aria-pressed={on}
              aria-disabled={!on && full}
              onClick={() => toggle(t.id)}
            >
              {on && "✓ "}
              {t.name}
            </button>
          );
        })}
      </div>
      <Msg
        id="f-tracks-selected-msg"
        help={full ? `That's ${EVENT.maxTracks}. Remove one to pick another.` : undefined}
        error={showAll ? errors["tracks.selected"] : undefined}
      />

      {selected.map((id) => {
        const t = EVENT.tracks.find((x) => x.id === id);
        return (
          <div key={id} className="trackbox">
            <TextField
              path={`tracks.justification.${id}`}
              label={`How you used ${t?.name ?? id}`}
              multiline
              limit={1500}
              placeholder="Which feature, where in the code, and why it matters."
            />
          </div>
        );
      })}
    </section>
  );
}
