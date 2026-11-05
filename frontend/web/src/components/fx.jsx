/*
 * Motion layer, built on the `motion` library (motion.dev).
 * Small, reusable effects every page shares. All of them respect
 * prefers-reduced-motion: <MotionConfig reducedMotion="user"> in App turns
 * transforms off, and the CSS loops are stopped by components.css.
 */
import { Children, Fragment, useRef } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";

/* ---------------------------------------------------------- presets */

export const spring = { type: "spring", stiffness: 380, damping: 30 };
export const softSpring = { type: "spring", stiffness: 160, damping: 22, mass: 0.9 };
export const bouncy = { type: "spring", stiffness: 520, damping: 18 };
export const easeOut = [0.16, 1, 0.3, 1];

/** Parent/child variants for staggered entrances. */
export const stagger = (gap = 0.07, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});
export const fadeUp = {
  hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: easeOut } },
};
export const popIn = {
  hidden: { opacity: 0, scale: 0.85, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: bouncy },
};

/* ------------------------------------------------------- page chrome */

/** Paper ground: a dot grid plus three slow, blurred colour glows. Purely decorative. */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <span className="backdrop__glow backdrop__glow--crush" />
      <span className="backdrop__glow backdrop__glow--oracle" />
      <span className="backdrop__glow backdrop__glow--sunny" />
      <span className="backdrop__grid" />
      <span className="backdrop__grain" />
    </div>
  );
}

/** Thin crush→oracle bar across the top that tracks page scroll. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });
  return <motion.div className="scroll-progress" style={{ scaleX }} aria-hidden="true" />;
}

/** Fade-up when the element scrolls into view (once). */
export function Reveal({ as = "div", delay = 0, y = 24, className, children, ...rest }) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.75, ease: easeOut, delay }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Headline that rises word by word out of a mask. Children may mix strings and
 * elements; strings are split on spaces, elements stay whole.
 */
export function SplitWords({ children, delay = 0, gap = 0.06, className }) {
  const words = [];
  Children.toArray(children).forEach((c) => {
    if (typeof c === "string") c.split(/\s+/).filter(Boolean).forEach((w) => words.push(w));
    else words.push(c);
  });
  return (
    <motion.span className={`split ${className ?? ""}`} initial="hidden" animate="show" variants={stagger(gap, delay)}>
      {words.map((w, i) => (
        <Fragment key={i}>
        <span className="split__mask">
          <motion.span
            className="split__word"
            variants={{
              hidden: { y: "105%", rotate: 4 },
              show: { y: "0%", rotate: 0, transition: { duration: 0.8, ease: easeOut } },
            }}
          >
            {w}
          </motion.span>
        </span>
        {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </motion.span>
  );
}

/** Hand-drawn underline that draws itself in. */
export function Squiggle({ className = "", delay = 0.6 }) {
  return (
    <svg className={`squiggle ${className}`} viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true">
      <motion.path
        d="M2 12 C 22 3, 38 3, 52 10 S 84 17, 100 9 S 132 2, 148 10 S 182 16, 198 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: "easeInOut", delay }}
      />
    </svg>
  );
}

/** Infinite ticker. Content is rendered twice so the loop is seamless. */
export function Marquee({ items, reverse = false, className = "", label }) {
  const row = (hidden) => (
    <ul className="marquee__row" aria-hidden={hidden || undefined}>
      {items.map((it, i) => (
        <li key={i} className="marquee__item">
          {it}
          <span className="marquee__star" aria-hidden="true">
            ✦
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={`marquee ${reverse ? "marquee--reverse" : ""} ${className}`} aria-label={label} role={label ? "region" : undefined}>
      <div className="marquee__track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

/**
 * 3D tilt toward the pointer with a soft light sheen. Off for touch and
 * reduced motion (springs settle at zero).
 */
export function Tilt({ children, className = "", max = 7, sheen = true, as = "div", ...rest }) {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), softSpring);
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), softSpring);
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const light = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgba(255,255,255,0.55), transparent 45%)`;
  const Tag = motion[as];
  const move = (e) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const leave = () => {
    px.set(0.5);
    py.set(0.5);
  };
  return (
    <Tag
      ref={ref}
      className={`tilt ${className}`}
      onPointerMove={move}
      onPointerLeave={leave}
      style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      {...rest}
    >
      {children}
      {sheen && !reduced && <motion.span className="tilt__sheen" style={{ background: light }} aria-hidden="true" />}
    </Tag>
  );
}

/** A sticker that floats on a loop and can be picked up and flung (snaps home). */
export function FloatSticker({ children, className = "", rotate = -6, delay = 0, drift = 8 }) {
  const reduced = useReducedMotion();
  return (
    <motion.span
      className={`float-sticker ${className}`}
      initial={{ opacity: 0, scale: 0.4, rotate: rotate - 20 }}
      animate={{ opacity: 1, scale: 1, rotate }}
      transition={{ ...bouncy, delay }}
      drag
      dragSnapToOrigin
      dragElastic={0.6}
      whileHover={{ scale: 1.08, rotate: rotate + 4 }}
      whileDrag={{ scale: 1.15, rotate: 0, cursor: "grabbing" }}
      aria-hidden="true"
    >
      <motion.span
        className="float-sticker__inner"
        animate={reduced ? undefined : { y: [0, -drift, 0] }}
        transition={{ duration: 3.6 + delay, repeat: Infinity, ease: "easeInOut", delay: delay + 0.6 }}
      >
        {children}
      </motion.span>
    </motion.span>
  );
}

/** Element that leans toward the pointer a little (buttons, marks). */
export function Magnetic({ children, strength = 0.25, className = "" }) {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const x = useSpring(0, spring);
  const y = useSpring(0, spring);
  const move = (e) => {
    if (reduced || e.pointerType !== "mouse") return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  return (
    <motion.span
      ref={ref}
      className={`magnetic ${className}`}
      style={{ x, y }}
      onPointerMove={move}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
