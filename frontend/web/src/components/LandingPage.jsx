import { motion } from "motion/react";
import { EVENT } from "../config/event.js";
import { Link } from "../lib/router.jsx";
import { Ring } from "./Arena.jsx";
import { PixelFighter } from "./PixelFighter.jsx";
import { useEvents, useProjects } from "./Projects.jsx";
import { FloatSticker, Magnetic, Reveal, SplitWords, Squiggle, Tilt, bouncy, fadeUp, stagger } from "./fx.jsx";
import { SUBMIT_PATH } from "./Header.jsx";

/** The empty slot at the end of the roster, waiting for the next submission. */
const GHOST = { id: "your-fighter", name: "Your fighter", pitch: "", description: "", tracks: [] };
const ROSTER_MAX = 6;

/* ---------------------------------------------------------------- hero */

function ArenaHero({ projects, eventName }) {
  const roster = (projects ?? []).slice(0, ROSTER_MAX);
  // Everyone stands on the mat in one row: shrink as the roster grows.
  const slots = roster.length + 1;
  const scale = slots <= 5 ? 5 : slots <= 7 ? 4 : 3;
  return (
    <section className="hero" aria-labelledby="hero-h">
      <motion.div className="hero__copy" initial="hidden" animate="show" variants={stagger(0.09, 0.05)}>
        <motion.span className="event-badge event-badge--live" variants={fadeUp}>
          <span className="live-dot" aria-hidden="true" />
          {eventName ?? EVENT.name}
        </motion.span>
        <h1 id="hero-h" className="t-display-xl m0 hero__title">
          <SplitWords delay={0.12}>
            Judge the product, not the
            <span className="hero__arena">
              pitch
              <Squiggle className="hero__squiggle" delay={0.9} />
            </span>
          </SplitWords>
        </h1>
        <motion.p className="t-body m0 hero__lede" variants={fadeUp}>
          We turn every hackathon project into an AI fighter, test it for real, and let AI judges pick the winner live in an arena.
        </motion.p>
        <motion.div className="hero__actions" variants={fadeUp}>
          <Magnetic>
            <Link to="/arena" className="btn btn--crush btn--lg btn--arrow">
              Watch a fight <span aria-hidden="true">→</span>
            </Link>
          </Magnetic>
          <Link to={SUBMIT_PATH} className="btn btn--ghost btn--underline">
            Submit a project
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero__stage"
        initial={{ opacity: 0, scale: 0.94, rotate: 2 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.15 }}
      >
        <Tilt className="hero__tilt" max={5}>
          <Ring className="hero__ring">
            <span className="hero__spot" aria-hidden="true" />
            <ul className="roster" aria-label="Fighters in the arena">
              {roster.map((p, i) => (
                <li key={p.id} className="roster__slot" style={{ "--i": i }}>
                  <Link to={`/projects/${encodeURIComponent(p.id)}`} className="roster__link">
                    <PixelFighter project={p} scale={scale} />
                    <span className="roster__name">{p.name}</span>
                  </Link>
                </li>
              ))}
              <li className="roster__slot" style={{ "--i": roster.length }}>
                <Link to={SUBMIT_PATH} className="roster__link roster__link--ghost">
                  <PixelFighter project={GHOST} scale={scale} ghost label="Empty slot for your fighter" />
                  <span className="roster__name roster__name--always">Your fighter?</span>
                </Link>
              </li>
            </ul>
          </Ring>
        </Tilt>
        <FloatSticker className="float-sticker--sunny hero__sticker hero__sticker--1" rotate={-8} delay={0.7}>
          3 AI judges
        </FloatSticker>
        <FloatSticker className="float-sticker--crush hero__sticker hero__sticker--2" rotate={7} delay={0.85} drift={10}>
          Tested on laptop + phone
        </FloatSticker>
        <FloatSticker className="float-sticker--oracle hero__sticker hero__sticker--3" rotate={-4} delay={1} drift={6}>
          Proof on 0G
        </FloatSticker>
      </motion.div>
    </section>
  );
}

const STEPS = [
  ["Submit", "Send your repo, your demo video and your live link. It takes two minutes.", "crush"],
  ["Agents check it", "One reads the code. One watches the demo. One checks every claim against the repo. Then we test the live app on a laptop and a phone.", "oracle"],
  ["The judges decide", "Three AI judges watch your fighter take on another, round by round. Every hit has a reason, and every reason links to proof on 0G.", "sunny"],
];

/** Tiny line icons for the three steps. */
function StepIcon({ n }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="how__icon" viewBox="0 0 32 32" aria-hidden="true">
      {n === 0 && (
        <g {...common}>
          <rect x="6" y="4" width="20" height="24" rx="4" />
          <path d="M11 12h10M11 17h10M11 22h6" />
        </g>
      )}
      {n === 1 && (
        <g {...common}>
          <path d="M11 9 4 16l7 7M21 9l7 7-7 7M18 6l-4 20" />
        </g>
      )}
      {n === 2 && (
        <g {...common}>
          <path d="M6 26 20 12M20 12l3-7 4 4-7 3M26 26 12 12M12 12 9 5 5 9l7 3" />
        </g>
      )}
    </svg>
  );
}

/** The problem, in the words we'd say out loud. */
function Problem() {
  return (
    <Reveal as="section" className="problem" aria-labelledby="problem-h">
      <span className="eyebrow">The problem</span>
      <h2 id="problem-h" className="t-display-md m0">
        Hundreds of projects. A few tired judges. Three minutes each.
      </h2>
      <p className="t-body m0 problem__body">
        Nobody has time to open every repo, so judges end up scoring the demo, not the product. Two fitness apps with crypto rewards can sound the same on stage. One works and one doesn't. Today, nobody checks.
      </p>
      <p className="t-body-strong m0 problem__fix">We check. Then we let them fight.</p>
    </Reveal>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="how" aria-labelledby="how-h">
      <Reveal className="section-title">
        <span className="eyebrow">Three steps</span>
        <h2 id="how-h" className="t-display-md m0">
          How it works
        </h2>
      </Reveal>
      <motion.ol className="how__list" initial="hidden" whileInView="show" viewport={{ once: true, margin: "-80px" }} variants={stagger(0.12)}>
        {STEPS.map(([title, body, tone], i) => (
          <motion.li key={title} className="how__item" variants={fadeUp}>
            <Tilt className={`how__step how__step--${tone}`} max={6}>
              <div className="how__top">
                <span className="how__num t-num">0{i + 1}</span>
                <span className={`how__badge how__badge--${tone}`}>
                  <StepIcon n={i} />
                </span>
              </div>
              <h3 className="t-heading m0">{title}</h3>
              <p className="t-caption m0">{body}</p>
            </Tilt>
          </motion.li>
        ))}
      </motion.ol>
    </section>
  );
}

/* ------------------------------------------------------------- landing */

export function LandingPage() {
  const { projects } = useProjects();
  const events = useEvents();
  const latest = events.at(-1);
  const parade = (projects ?? []).slice(0, 4);
  return (
    <>
      <ArenaHero projects={projects} eventName={latest?.name} />
      <Problem />
      <HowItWorks />
      <Reveal as="section" className="landing-cta" aria-label="See the roster">
        <div className="landing-cta__copy">
          <p className="t-display-md m0">Meet the fighters</p>
          <p className="t-body m0">Open any project to see its demo, its test runs and what the judges found.</p>
          <Link to="/projects" className="btn btn--primary btn--arrow">
            See all projects <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="landing-cta__parade" aria-hidden="true">
          {[...parade, GHOST].map((p, i) => (
            <motion.span
              key={p === GHOST ? "ghost" : p.id}
              className="landing-cta__fighter"
              initial={{ y: 60, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ ...bouncy, delay: 0.2 + i * 0.1 }}
            >
              <PixelFighter project={p} scale={6} ghost={p === GHOST} />
            </motion.span>
          ))}
        </div>
      </Reveal>
    </>
  );
}
