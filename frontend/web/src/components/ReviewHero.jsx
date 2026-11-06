/*
 * The top of the Agent judge view: the panel's score as a gauge, the
 * fact-check verdict, the claim tally and each judge's score at a glance.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api } from "../lib/api.js";
import { useCountUp } from "../lib/motion.js";
import { judgeAsFighter } from "./JudgesPage.jsx";
import { PixelFighter } from "./PixelFighter.jsx";

const R = 54;
const C = 2 * Math.PI * R;

function Gauge({ hundredths }) {
  const v = useCountUp(Math.round(hundredths ?? 0));
  const pct = hundredths == null ? 0 : Math.min(1, hundredths / 10000);
  const band = hundredths == null ? "none" : hundredths >= 7000 ? "high" : hundredths >= 5000 ? "mid" : "low";
  return (
    <div className={`gauge gauge--${band}`} role="img" aria-label={hundredths == null ? "Not scored yet" : `Panel average ${(hundredths / 100).toFixed(2)} out of 100`}>
      <svg viewBox="0 0 128 128" aria-hidden="true">
        <circle className="gauge__track" cx="64" cy="64" r={R} />
        <motion.circle
          className="gauge__fill"
          cx="64"
          cy="64"
          r={R}
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="gauge__text">
        <span className="gauge__n t-num">{hundredths == null ? "—" : (v / 100).toFixed(1)}</span>
        <span className="gauge__of">panel / 100</span>
      </div>
    </div>
  );
}

const TALLY = [
  ["supported_by_code", "good", "supported"],
  ["contradicted", "bad", "contradicted"],
  ["unverified", "meh", "unverified"],
];

export function ReviewHero({ project, live }) {
  const [data, setData] = useState({ result: project.reviews ?? null, dossier: project.dossier ?? null });
  const finishedAt = live?.state?.finishedAt;
  useEffect(() => {
    let alive = true;
    const id = encodeURIComponent(project.id);
    Promise.all([api(`/projects/${id}/reviews`).catch(() => null), project.kind === "submitted" ? api(`/projects/${id}/dossier`).catch(() => null) : null]).then(([r, d]) => {
      if (alive) setData((x) => ({ result: r?.result ?? x.result, dossier: d?.dossier ?? x.dossier }));
    });
    return () => {
      alive = false;
    };
  }, [project.id, project.kind, finishedAt]);

  const { result, dossier } = data;
  const scored = result?.reviews?.filter((r) => r.status === "scored") ?? [];
  const count = (s) => dossier?.evidence?.filter((e) => e.status === s).length ?? 0;
  const headline = dossier?.highlights?.headline;

  return (
    <section className="card rhero rise" style={{ "--i": 0 }} aria-label="Review at a glance">
      <Gauge hundredths={result?.panelHundredths ?? null} />
      <div className="rhero__main">
        <span className="t-label">Verdict</span>
        <p className="rhero__headline m0">
          {headline ?? (result ? `${scored.length} of ${result.reviews.length} judges scored ${project.name}.` : `${project.name} hasn't been judged yet.`)}
        </p>
        {dossier?.evidence?.length > 0 && (
          <div className="rhero__tally" aria-label={`${dossier.evidence.length} claims checked against the code`}>
            {TALLY.filter(([s]) => count(s)).map(([s, tone, word]) => (
              <span key={s} className={`tchip tchip--${tone}`}>
                <span aria-hidden="true">{tone === "good" ? "✓" : tone === "bad" ? "✕" : "?"}</span>
                <span className="t-num">{count(s)}</span> {word}
              </span>
            ))}
            <span className="t-caption">of {dossier.evidence.length} claims checked against the code</span>
          </div>
        )}
      </div>
      {result?.reviews?.length > 0 && (
        <ul className="rhero__judges" aria-label="Each judge's score">
          {result.reviews.map((r, i) => (
            <motion.li key={r.judge.id} className="rjudge" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.08 }}>
              <span className="rjudge__face">
                <PixelFighter project={judgeAsFighter(r.judge)} scale={2} label={`${r.judge.name}, judge`} />
              </span>
              <span className="rjudge__name">{r.judge.name.split(" ")[0]}</span>
              <span className="rjudge__score t-num">{r.status === "scored" ? (r.overallHundredths / 100).toFixed(1) : "—"}</span>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
