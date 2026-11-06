/*
 * HTTP surface for the agent service. Internal: the tournament orchestrator calls
 * these, not browsers (judges must never be callable by spectators). If
 * AGENT_API_TOKEN is set, every call needs `Authorization: Bearer <token>`.
 *
 * Corners are passed as { A: { project, dossier }, B: { project, dossier } }.
 */
const express = require("express");
const agents = require("../agents");
const { matchContext } = require("../agents/dossier");
const { DEFAULT_JUDGES } = require("../agents/rubric");
const zg = require("../zg/client");
const { frozenConfig } = require("../zg/models");

const router = express.Router();

router.use((req, res, next) => {
  const token = process.env.AGENT_API_TOKEN;
  if (token && req.get("authorization") !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
  next();
});

const judgeById = (j) => (typeof j === "string" ? DEFAULT_JUDGES.find((d) => d.id === j) : j);
const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req.body ?? {}));
  } catch (err) {
    const status = err.name === "ZgError" ? (err.status === 402 ? 402 : err.code === "invalid_model_output" ? 422 : 502) : 400;
    res.status(status).json({ error: err.message, code: err.code, requestId: err.requestId });
  }
};

router.get("/config", (req, res) => res.json({ ...frozenConfig(agents.PROMPT_VERSION), judges: DEFAULT_JUDGES, criteria: agents.CRITERIA }));
router.get("/models", wrap(async () => zg.listModels()));

router.post("/fighter", wrap(({ project, dossier }) => agents.createFighter({ project, dossier })));

router.post(
  "/question",
  wrap(({ judge, criterionId, corners, events, tiebreak }) => agents.judgeQuestion({ judge: judgeById(judge), criterionId, ctx: matchContext(corners), events, tiebreak })),
);

router.post(
  "/turn",
  wrap(({ side, kind, criterionId, fighter, corners, events, question, target }) =>
    agents.advocateTurn({ side, kind, criterionId, fighter, ctx: matchContext(corners), events, question, target }),
  ),
);

router.post(
  "/scorecard",
  wrap(({ judge, criterionId, corners, events, challenges }) =>
    agents.judgeScorecard({ judge: judgeById(judge), criterionId, ctx: matchContext(corners), events, challenges }),
  ),
);

router.post("/rulings/tally", wrap(({ labels }) => ({ label: agents.tallyRulings(labels) })));

router.post(
  "/screenshot",
  wrap(({ imageBase64, mime, projectName, step }) => agents.analyzeScreenshot({ image: Buffer.from(imageBase64, "base64"), mime, projectName, step })),
);

router.post(
  "/voice-note",
  wrap(({ audioBase64, mime, filename, judge }) => agents.voiceNoteToGuidance({ audio: Buffer.from(audioBase64, "base64"), mime, filename, judge: judgeById(judge) })),
);

router.post("/narrate", async (req, res) => {
  try {
    const { audio, mime, trace } = await agents.narrate(req.body ?? {});
    res.set("Content-Type", mime).set("X-0G-Request-Id", trace.requestId ?? "").send(audio);
  } catch (err) {
    res.status(502).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
