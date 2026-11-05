import { FileField, RadioCards, TagInput, TextField, useForm } from "../components/fields.jsx";
import { EVENT } from "../config/event.js";

export function ProjectSection() {
  const { data } = useForm();
  return (
    <section id="project" className="card sec" aria-labelledby="project-h">
      <h2 id="project-h" className="t-display-md">Project</h2>
      <div className="grid2">
        <TextField path="project.name" label="Project name" limit={60} />
        <TextField path="project.pitch" label="Short pitch" limit={140} placeholder="One line that sells it" />
      </div>
      <TextField path="project.problem" label="Problem" multiline limit={1000} placeholder="What's broken today, and for whom?" />
      <TextField path="project.users" label="Who it's for" multiline limit={500} placeholder="The people who'd use this first" />
      <TextField
        path="project.howItsMade"
        label="How it's made"
        multiline
        limit={3000}
        help="Architecture, key libraries, anything hacky. The judges check this against your code."
      />
      <TagInput path="project.tags" label="Tech stack" help="Press Enter after each one. Up to 10." />
      <TextField
        path="project.limitations"
        label="Known limitations"
        multiline
        optional
        limit={1500}
        help="Your fighter admits these honestly instead of getting caught out in the defense round."
      />

      <RadioCards
        path="project.builtAtEvent"
        legend={`Did you build this at ${EVENT.name}?`}
        options={[
          { value: "yes", label: "Yes, all of it", hint: "Started at the event" },
          { value: "no", label: "No, we started earlier", hint: "Tell us when below" },
        ]}
      />
      {data.project.builtAtEvent === "no" && (
        <div className="grid2">
          <TextField
            path="project.startDate"
            label="When did work start?"
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            help="Judges weigh what's new at the event. Being upfront doesn't cost you."
          />
        </div>
      )}

      <div className="grid2">
        <FileField path="project.logo" label="Logo" optional kinds={["image"]} help="Square works best. JPG, PNG or WebP, up to 20 MB." />
        <FileField path="project.cover" label="Cover image" optional kinds={["image"]} help="Shown on your fighter card. Up to 20 MB." />
      </div>
    </section>
  );
}
