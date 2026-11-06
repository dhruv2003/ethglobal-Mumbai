import { useEffect } from "react";
import confetti from "canvas-confetti";
import { motion } from "motion/react";
import { StatusPill } from "@ds/ui.jsx";
import { Ring } from "./Arena.jsx";
import { bouncy, fadeUp, stagger } from "./fx.jsx";
import { prefersReducedMotion } from "../lib/motion.js";
import { PixelFighter } from "./PixelFighter.jsx";
import { Link } from "../lib/router.jsx";
import { shortAddress } from "../lib/wallet.js";
import { StorageProof } from "./ZeroGProof.jsx";

/* The celebration palette: the three brand colours plus ink. */
const BURST = ["#ff5c93", "#2f4bf0", "#ffd43b", "#17141f", "#ffe3ec"];

function celebrate() {
  if (prefersReducedMotion()) return () => {};
  const fire = (ratio, opts) => confetti({ origin: { y: 0.6 }, colors: BURST, disableForReducedMotion: true, particleCount: Math.floor(220 * ratio), ...opts });
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.9 });
  const t = setTimeout(() => {
    confetti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors: BURST });
    confetti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors: BURST });
  }, 350);
  return () => clearTimeout(t);
}

/** The one sticker moment on this screen. */
export function Success({ record, onStartOver }) {
  useEffect(celebrate, []);
  function download() {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `submission-${record.id}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="success">
      <motion.div
        className="card card--sticker success__card"
        initial={{ opacity: 0, scale: 0.85, rotate: -2, y: 30 }}
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
      >
        <Ring className="success__ring">
          <PixelFighter
            project={{ seed: record.fighterSeed ?? record.id, name: record.project.name, pitch: record.project.pitch, description: record.project.description, tracks: record.tracks }}
            scale={9}
            className="fighter--cheer"
          />
        </Ring>
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...bouncy, delay: 0.35 }}>
          <StatusPill tone="success">✓ Submitted</StatusPill>
        </motion.span>
        <h1 className="t-display-lg m0">{record.project.name} is in the arena</h1>
        <p className="t-body m0">
          Next we fetch your repo, pin the commit and build your fighter's dossier. You can still edit until freeze.
        </p>
        <dl className="success__meta">
          <div>
            <dt className="t-label">Team</dt>
            <dd className="t-body">{record.team.name}</dd>
          </div>
          <div>
            <dt className="t-label">Tracks</dt>
            <dd className="t-body">{record.tracks.length ? `Finalist + ${record.tracks.length}` : "Finalist"}</dd>
          </div>
          <div>
            <dt className="t-label">Owner</dt>
            <dd className="t-mono">{shortAddress(record.ownerWallet)}</dd>
          </div>
        </dl>
        <p className="t-mono-caption m0">
          id {record.id} · signed {new Date(record.auth?.issuedAt ?? record.submittedAt).toLocaleString()}
        </p>
        {record.savedLocallyOnly ? (
          <p className="t-caption m0">Saved in this browser only: the server was offline, so it isn't on 0G Storage yet.</p>
        ) : (
          record.zgStorage && <StorageProof kind="submission" id={record.id} initial={record.zgStorage} />
        )}
      </motion.div>
      <motion.div className="success__actions" initial="hidden" animate="show" variants={stagger(0.08, 0.5)}>
        <motion.span variants={fadeUp}>
          <Link to={`/projects/${encodeURIComponent(record.id)}`} className="btn btn--primary btn--arrow">
            See your project page <span aria-hidden="true">→</span>
          </Link>
        </motion.span>
        <motion.span variants={fadeUp}>
          <button type="button" className="btn btn--secondary" onClick={download}>
            Download a copy
          </button>
        </motion.span>
        <motion.span variants={fadeUp}>
          <button type="button" className="btn btn--ghost" onClick={onStartOver}>
            Enter another project
          </button>
        </motion.span>
      </motion.div>
    </div>
  );
}
