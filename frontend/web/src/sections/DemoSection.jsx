import { Progress } from "@ds/ui.jsx";
import { FileField, Msg, TextField, useForm } from "../components/fields.jsx";
import { LIMITS } from "../config/event.js";
import { fmtSize, totalFileBytes } from "../lib/validate.js";

export function DemoSection() {
  const { data, errors, warnings, showAll, touched } = useForm();
  const used = totalFileBytes(data);
  const pct = Math.min(100, Math.round((used / LIMITS.total) * 100));
  const videoErr = showAll || touched["demo.videoUrl"] || touched["demo.videoFile"] ? errors["demo.video"] : undefined;

  return (
    <section id="demo" className="card sec" aria-labelledby="demo-h">
      <h2 id="demo-h" className="t-display-md">Demo</h2>

      <div className="stack-sm">
        <span className="label">Demo video</span>
        <p className="t-caption m0">2 to 4 minutes. It's the main evidence for the product round, which is 40% of the score.</p>
        <div className="grid2">
          <TextField path="demo.videoUrl" label="Video link" type="url" inputMode="url" placeholder="https://youtu.be/…" autoCapitalize="off" spellCheck={false} />
          <FileField path="demo.videoFile" label="Or upload an MP4" kinds={["video"]} help="Up to 200 MB." />
        </div>
        <Msg id="f-demo-video-msg" error={videoErr} warning={warnings["demo.video"]} />
      </div>

      <TextField
        path="demo.liveUrl"
        label="Live demo"
        optional
        type="url"
        inputMode="url"
        placeholder="https://your-app.xyz"
        help="Where judges can try it. Testnet is fine."
        autoCapitalize="off"
        spellCheck={false}
      />

      <FileField
        path="demo.artifacts"
        errorPath="demo.artifacts"
        label="Photos, slides and docs"
        optional
        multiple
        kinds={["image", "pdf", "text"]}
        help="JPG, PNG, WebP, PDF or text. Up to 20 MB each."
      />

      <div className="stack-xs">
        <span className="t-caption t-num">
          {fmtSize(used)} of {fmtSize(LIMITS.total)} used across all files
        </span>
        <Progress value={pct} label="Upload space used" />
      </div>
      <p className="t-caption m0">Files stay on this device until you submit. Drafts don't keep files, so re-add them if you reload.</p>
    </section>
  );
}
