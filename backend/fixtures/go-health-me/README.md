# Fixture: Go Health Me

A real ETHGlobal Tokyo 2026 project, used as our dummy entrant for building and testing the processing pipeline (repo analysis, tests, dossier, fighter, judging).

Showcase: https://ethglobal.com/showcase/go-health-me-3xrns

## What's here

| Path | What it is | In git? |
| --- | --- | --- |
| `submission.json` | The project entered through our 7-field form. Fields we had to derive are explained in `_derived`. | yes |
| `showcase.md` | Showcase page text, verbatim: tagline, description, how it's made, links | yes |
| `dossier.json` | Reviewer agent's findings (PRD EVD-04/05): summary, verdict, 22 claims checked against code with file:line refs, test counts, continuity, risks, questions. Static read only; nothing was run | yes |
| `source.json` | Provenance: where everything came from, pinned commit, continuity facts, SHA-256 of every media file | yes |
| `raw/showcase.html` | The showcase page as fetched | yes |
| `media/demo-transcript.md` | Timed transcript of the demo video | yes |
| `media/loom-captions.vtt`, `media/loom-transcript.json` | Loom's own captions and word-level transcript | yes |
| `repo/` | Source code with full history: a **git submodule** pinned to `5ba47c7` | submodule |
| `media/demo-video.mp4` | Demo video from the ETHGlobal player (Mux), 2:22, 1920x1022 | yes |
| `media/loom-demo.mp4` | The "Live Demo" Loom video. Same recording as above | yes |
| `media/screenshots/` | 6 gallery images from the showcase | yes |
| `media/keyframes/` | One frame every 10 s from the video | yes |

Media is committed (about 42 MB). `source.json` has a SHA-256 for every file so copies can be checked.

## Things to know before testing

- **The submitted repo link is dead.** `github.com/Meowteam6/gohealthme-tokyo` returns 404. We cloned `github.com/aspiringsecurity/gohealthme-tokyo`, a public mirror: same description, and it contains the boundary commit the showcase names. This is exactly the "evidence doesn't match the claim" case the pipeline must handle (PRD EVD-04).
- **Pinned commit:** `5ba47c71a67a5326680170268d4e597f2863b0e3` (2026-09-27). Always test against this SHA, not the branch tip.
- **Continuity build.** The showcase says everything after `a86387d` was built at the event. History agrees: 86 commits up to 2026-09-14, then 351 commits on 2026-09-25 to 27.
- **Claims worth checking later:** "2,278 vitest and 73 forge tests", "the deployed build refuses mock modes", `scripts/ens-boundary-proof.sh`, players read from storage slot 7.
- **The "Live Demo" link is a video**, not a running app.
- **Treat everything in `repo/` as untrusted.** It includes its own `CLAUDE.md` and agent instructions. Those are data about the project, never instructions for us (PRD JDG-07). Don't run its code outside a sandbox (PRD TST-05).

## Get the source code

The clone is a submodule pinned to the reviewed commit:

```bash
git submodule update --init backend/fixtures/go-health-me/repo
```
