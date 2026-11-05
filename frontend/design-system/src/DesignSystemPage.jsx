import { useState } from "react";
import "./page.css";
import { Button, Chip, StatusPill, Card, Input, OddsBar, Progress, Avatar } from "./ui.jsx";

/* ---------------------------------------------------------------------------
   Data: mirrors tokens.css. If you change a token, change it in both places.
--------------------------------------------------------------------------- */

const COLOR_GROUPS = [
  {
    title: "Grounds",
    tokens: [
      ["canvas", "#FFFDF8", "Milk. The default page ground."],
      ["surface", "#F7F2EA", "Cream. Cards, fields, secondary panels."],
      ["surface-sunken", "#EFE8DC", "Wells, skeletons, disabled fills, progress tracks."],
      ["arena-canvas", "#F1F3FF", "A second room: protocol / arena screens. Cards sit on it in canvas."],
    ],
  },
  {
    title: "Ink & lines",
    tokens: [
      ["ink", "#17141F", "Primary text and icons on every ground.", "#fffdf8"],
      ["ink-secondary", "#5F5869", "Captions, metadata, helper text.", "#fffdf8"],
      ["line", "#ECE5D9", "Hairline dividers. Decorative only."],
      ["line-strong", "#8F879A", "Control borders at rest (3.4:1).", "#fffdf8"],
      ["action", "#17141F", "Primary button, selected filter, current tab.", "#fffdf8"],
      ["action-hover", "#2E2938", "Hover / pressed fill of action.", "#fffdf8"],
    ],
  },
  {
    title: "Crush: people",
    tokens: [
      ["crush", "#FF5C93", "Fill only, always ink on it. Never as text."],
      ["crush-soft", "#FFE3EC", "Tinted ground behind a person moment."],
      ["crush-ink", "#C2185B", "The only crush allowed as text.", "#fffdf8"],
    ],
  },
  {
    title: "Oracle: the protocol",
    tokens: [
      ["oracle", "#2F4BF0", "Chain data, live state, focus. Allowed as text on canvas.", "#fffdf8"],
      ["oracle-hover", "#2238C4", "Pressed state of oracle elements.", "#fffdf8"],
      ["oracle-soft", "#E8ECFF", "Tinted panels behind protocol content."],
    ],
  },
  {
    title: "Sunny: tokens & rewards",
    tokens: [
      ["sunny", "#FFD43B", "Fill only, ink on it. Reward chips, balances."],
      ["sunny-soft", "#FFF4C7", "Ground behind token figures and reward notes."],
    ],
  },
  {
    title: "Two sides of a pool",
    tokens: [
      ["stake-yes", "#2F4BF0", "Side A / Yes. Always paired with its word.", "#fffdf8"],
      ["stake-no", "#B04E00", "Side B / No as text. Tangerine, not red.", "#fffdf8"],
      ["stake-no-fill", "#FF8A2B", "Side B / No as a bar fill."],
      ["stake-no-soft", "#FFEBD9", "Ground behind side B content."],
    ],
  },
  {
    title: "Status",
    tokens: [
      ["success", "#0E7C57", "Verified outcomes. Always with a word + icon.", "#fffdf8"],
      ["success-soft", "#DDF5EA", "Ground behind verified content."],
      ["danger", "#C4291C", "Errors, voided states. Always with a word + icon.", "#fffdf8"],
      ["danger-soft", "#FDE7E4", "Ground behind error content."],
    ],
  },
];

const TYPE = [
  ["t-display-xl", "display-xl", "Bricolage 800 · 60/58", "One per screen. Hero + celebration.", "Champion."],
  ["t-display-lg", "display-lg", "Bricolage 800 · 40/42", "Screen headlines, big moments, empty states.", "Round one is live"],
  ["t-display-md", "display-md", "Bricolage 700 · 28/32", "Section titles, countdowns, scores.", "82.00 final score"],
  ["t-prompt", "prompt", "Bricolage 600 · 24/30", "Someone's own words, set large.", "We turned a 40-page report into a 2-minute flow."],
  ["t-heading", "heading", "Figtree 700 · 20/26", "Card titles, names, sheet headers.", "Project Atlas"],
  ["t-body", "body", "Figtree 400 · 16/24", "Default copy.", "Betting closes before the first round starts."],
  ["t-body-strong", "body-strong", "Figtree 600 · 16/24", "Emphasis, list labels, totals.", "1,240 tokens in the pool"],
  ["t-caption", "caption", "Figtree 500 · 13/18", "Metadata, helper text, timers.", "Closes in 4m 12s"],
  ["t-label", "label", "Figtree 700 · 13/16", "Small section labels. Sentence case.", "Engineering round"],
  ["t-button", "button", "Figtree 700 · 16/20", "Every button and pill label.", "Back this project"],
  ["t-mono", "mono-address", "JetBrains Mono 500 · 14/20", "Addresses, handles, hashes.", "0x7a3f…c209"],
  ["t-mono-caption", "mono-caption", "JetBrains Mono 400 · 12/16", "Chain data inside captions.", "block 18,204,551 · 19:42"],
];

const SPACING = [
  ["space-1", 4, "Icon-to-label gaps"],
  ["space-2", 8, "Chip padding, gaps between pills"],
  ["space-3", 12, "Inside compact rows"],
  ["space-4", 16, "Phone gutter; compact card padding"],
  ["space-5", 20, "Standard card padding"],
  ["space-6", 24, "Between sections inside a screen"],
  ["space-8", 32, "Between major blocks"],
  ["space-12", 48, "Hero / celebration rhythm"],
];

const RADII = [
  ["radius-sm", "10px", "Small tags inside cards"],
  ["radius-md", "16px", "Fields, options, bubbles"],
  ["radius-lg", "28px", "Cards"],
  ["radius-xl", "40px", "Photos, sheets, hero moments"],
  ["radius-pill", "999px", "Buttons, chips, pills, bars"],
];

const DURATIONS = [
  ["dur-instant", "100ms", "Press feedback: buttons scale, stickers sink."],
  ["dur-fast", "180ms", "Hover, focus, chip and tab changes."],
  ["dur-base", "260ms", "The default: panels, odds changes, messages arriving."],
  ["dur-slow", "480ms", "Arrivals with distance: sheets, hero cards, rings drawing."],
  ["dur-celebrate", "1400ms", "The one full-screen celebration only."],
];

const EASINGS = [
  ["ease-standard", "cubic-bezier(0.2, 0, 0.2, 1)", "Changes in place: colour, opacity."],
  ["ease-out", "cubic-bezier(0.16, 1, 0.3, 1)", "Anything entering or expanding."],
  ["ease-in", "cubic-bezier(0.4, 0, 1, 1)", "Anything leaving."],
  ["ease-spring", "cubic-bezier(0.34, 1.56, 0.64, 1)", "Touch responses and arrivals."],
  ["ease-pop", "cubic-bezier(0.5, 1.9, 0.45, 0.85)", "Small things (<80px) popping in."],
];

const SECTIONS = [
  ["principles", "Principles"],
  ["color", "Colour"],
  ["type", "Type"],
  ["spacing", "Spacing"],
  ["shape", "Shape & depth"],
  ["motion", "Motion"],
  ["components", "Components"],
  ["voice", "Voice"],
  ["a11y", "Accessibility"],
  ["usage", "How to use"],
];

/* --------------------------------------------------------------------------- */

function useCopy() {
  const [msg, setMsg] = useState("");
  const copy = (text) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {}
    setMsg(`Copied ${text}`);
    clearTimeout(window.__dsToast);
    window.__dsToast = setTimeout(() => setMsg(""), 1400);
  };
  return [msg, copy];
}

function Section({ id, title, lede, children }) {
  return (
    <section id={id} className="ds-section">
      <h2 className="t-display-lg">{title}</h2>
      {lede && <p className="lede t-body">{lede}</p>}
      {children}
    </section>
  );
}

function MotionDemo({ name, curve, duration = "var(--dur-slow)" }) {
  const [go, setGo] = useState(false);
  return (
    <Card className="motion-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="t-label">--{name}</span>
        <Button size="sm" variant="secondary" onClick={() => setGo((g) => !g)}>
          Play
        </Button>
      </div>
      <div className={`motion-track ${go ? "go" : ""}`}>
        <span className="motion-dot" style={{ transition: `left ${duration} ${curve}` }} />
      </div>
    </Card>
  );
}

export default function DesignSystemPage() {
  const [toast, copy] = useCopy();
  const [filter, setFilter] = useState("Live");
  const [yes, setYes] = useState(62);

  return (
    <>
      <nav className="ds-nav" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <main className="ds">
        {/* ---------------- Hero ---------------- */}
        <header className="ds-hero">
          <div className="eyebrow">
            <StatusPill tone="live">v1 · source of truth</StatusPill>
            <StatusPill tone="reward">ETHGlobal Mumbai</StatusPill>
          </div>
          <h1 className="t-display-xl" style={{ margin: 0 }}>Playful Minimal</h1>
          <p>
            Warm milk-white space, one chunky display face, three bright colours that each do one job,
            and a sticker flourish saved for the moments that matter. It should feel warm with a toy-like
            snap, never like a trading terminal.
          </p>
          <p className="t-caption">
            Every value on this page lives in <code>src/tokens.css</code>. Click any swatch or token to copy its
            variable.
          </p>
        </header>

        {/* ---------------- Principles ---------------- */}
        <Section id="principles" title="Principles">
          <div className="grid grid-3">
            {[
              ["Tokens only", "Never hard-code a colour, space, radius, shadow or duration. If a value is missing, add a token first."],
              ["Three colours, three jobs", "Crush is people. Oracle is the protocol. Sunny is tokens and rewards. They never swap jobs."],
              ["Flat by default", "The sticker (ink border + hard drop shadow) is rationed. More than two visible at once means one is wrong."],
              ["Motion answers something", "A touch, an arrival or an outcome. Nothing moves just to fill a pause."],
              ["Never colour alone", "Every state carries a word, usually an icon too. Yes, No, live, verified, error."],
              ["One primary per screen", "One ink primary button per screen. Everything else steps down to secondary or ghost."],
            ].map(([t, d], i) => (
              <Card key={t} className="principle">
                <span className="num">0{i + 1}</span>
                <h3 className="t-heading" style={{ margin: 0 }}>{t}</h3>
                <p className="t-body">{d}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* ---------------- Colour ---------------- */}
        <Section
          id="color"
          title="Colour"
          lede="Anything that isn't a person, the protocol or a token is ink on canvas. Use the job colours sparingly so they keep their meaning."
        >
          <div className="grid grid-3" style={{ marginBottom: "var(--space-6)" }}>
            <div className="job" style={{ background: "var(--crush-soft)" }}>
              <span className="avatar" style={{ background: "var(--crush)", border: "2px solid var(--ink)" }}>♥</span>
              <h3 className="t-heading">Crush is a person</h3>
              <p className="t-body">Likes, people moments, signatures, celebration confetti. Fill only. As text use <code>crush-ink</code>.</p>
            </div>
            <div className="job" style={{ background: "var(--oracle-soft)" }}>
              <span className="avatar" style={{ background: "var(--oracle)", color: "var(--on-oracle)" }}>◆</span>
              <h3 className="t-heading">Oracle is the protocol</h3>
              <p className="t-body">Markets, chain data, live state, scores, focus rings. The only colour allowed as text on canvas.</p>
            </div>
            <div className="job" style={{ background: "var(--sunny-soft)" }}>
              <span className="avatar" style={{ background: "var(--sunny)" }}>⚡</span>
              <h3 className="t-heading">Sunny is tokens</h3>
              <p className="t-body">Balances, reward chips, payout moments. Fill only, always with ink on it.</p>
            </div>
          </div>

          {COLOR_GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="t-heading ds-sub">{g.title}</h3>
              <div className="grid grid-4">
                {g.tokens.map(([name, hex, usage, fg]) => (
                  <button key={name} className="swatch" onClick={() => copy(`var(--${name})`)} aria-label={`Copy var(--${name})`}>
                    <span className="swatch__chip" style={{ background: `var(--${name})`, color: fg || "var(--ink)" }}>
                      <span className="t-label">Aa</span>
                    </span>
                    <span className="swatch__meta">
                      <span className="t-body-strong">{name}</span>
                      <span className="t-mono-caption">{hex}</span>
                      <span className="t-caption usage">{usage}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Section>

        {/* ---------------- Type ---------------- */}
        <Section
          id="type"
          title="Type"
          lede="Bricolage Grotesque for display, Figtree for everything else, JetBrains Mono for chain data. Sentence case everywhere. Numbers that tick use tabular figures (.t-num)."
        >
          {TYPE.map(([cls, name, spec, usage, sample]) => (
            <div key={name} className="type-row">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="t-body-strong">{name}</span>
                <span className="t-mono-caption">.{cls}</span>
                <span className="t-mono-caption">{spec}</span>
                <span className="t-caption">{usage}</span>
              </div>
              <div className={`sample ${cls}`}>{sample}</div>
            </div>
          ))}
        </Section>

        {/* ---------------- Spacing ---------------- */}
        <Section id="spacing" title="Spacing" lede="A 4px base. Phone gutter is space-4, card padding is space-5, sections are space-6 apart.">
          <Card>
            {SPACING.map(([name, px, usage]) => (
              <div key={name} className="space-row">
                <button className="chip chip--tag" style={{ cursor: "pointer" }} onClick={() => copy(`var(--${name})`)}>
                  {name}
                </button>
                <span className="t-mono-caption">{px}px</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="space-bar" style={{ width: px * 3 }} />
                  <span className="t-caption">{usage}</span>
                </div>
              </div>
            ))}
          </Card>
        </Section>

        {/* ---------------- Shape ---------------- */}
        <Section id="shape" title="Shape & depth" lede="Big and soft. Flat by default; cards sit on a line, or on shadow-soft when they float.">
          <div className="grid grid-4">
            {RADII.map(([name, val, usage]) => (
              <button key={name} className="swatch" onClick={() => copy(`var(--${name})`)}>
                <span style={{ padding: 16 }}>
                  <span className="radius-box" style={{ display: "block", borderRadius: `var(--${name})` }} />
                </span>
                <span className="swatch__meta">
                  <span className="t-body-strong">{name}</span>
                  <span className="t-mono-caption">{val}</span>
                  <span className="t-caption">{usage}</span>
                </span>
              </button>
            ))}
          </div>

          <h3 className="t-heading ds-sub">Shadows</h3>
          <div className="grid grid-3">
            <Card>
              <span className="t-body-strong">Flat (default)</span>
              <p className="t-caption" style={{ margin: "4px 0 0" }}>1px <code>line</code> border. Most cards.</p>
            </Card>
            <Card variant="float">
              <span className="t-body-strong">shadow-soft</span>
              <p className="t-caption" style={{ margin: "4px 0 0" }}>Things that float: raised cards, floating buttons.</p>
            </Card>
            <Card variant="sticker" style={{ background: "var(--sunny)" }}>
              <span className="t-body-strong">shadow-pop · the sticker</span>
              <p className="t-body" style={{ margin: "4px 0 0" }}>2px ink border + 4px hard ink drop. Moments only. Sinks 3px on press.</p>
            </Card>
          </div>
        </Section>

        {/* ---------------- Motion ---------------- */}
        <Section
          id="motion"
          title="Motion"
          lede="Touch gets a spring, arrivals get a pop, the big outcome gets the one full-screen celebration. Animate transform, opacity, clip-path and stroke-dashoffset only. Everything respects prefers-reduced-motion."
        >
          <h3 className="t-heading ds-sub" style={{ marginTop: 0 }}>Easings: press Play</h3>
          <div className="grid grid-2">
            {EASINGS.map(([name, curve, usage]) => (
              <div key={name}>
                <MotionDemo name={name} curve={`var(--${name})`} />
                <p className="t-caption" style={{ margin: "8px 4px 0" }}>{usage} <span className="t-mono-caption">{curve}</span></p>
              </div>
            ))}
          </div>

          <h3 className="t-heading ds-sub">Durations</h3>
          <Card>
            {DURATIONS.map(([name, val, usage]) => (
              <div key={name} className="space-row" style={{ gridTemplateColumns: "140px 80px 1fr" }}>
                <button className="chip chip--tag" style={{ cursor: "pointer" }} onClick={() => copy(`var(--${name})`)}>{name}</button>
                <span className="t-mono-caption">{val}</span>
                <span className="t-caption">{usage}</span>
              </div>
            ))}
          </Card>

          <h3 className="t-heading ds-sub">Rules</h3>
          <div className="grid grid-2">
            <Card variant="surface">
              <ul className="t-body" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                <li>Every pressable thing reacts within <code>dur-instant</code>: buttons scale to 0.97, stickers sink 3px, icon buttons scale to 0.92.</li>
                <li>Pops are for things under 80px. A full card never pops; it springs.</li>
                <li>Direction means something: sheets rise from the bottom and fall back the same way.</li>
              </ul>
            </Card>
            <Card variant="surface">
              <ul className="t-body" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                <li>Numbers move only with their cause. A balance never ticks up on page load.</li>
                <li>Loops mean waiting. Only a live indicator or a pending state may loop.</li>
                <li>Reduced motion: movement goes, the outcome stays. Show final numbers at once.</li>
              </ul>
            </Card>
          </div>
        </Section>

        {/* ---------------- Components ---------------- */}
        <Section id="components" title="Components" lede="Live from src/ui.jsx. Import them; don't restyle them per screen.">
          <div className="grid grid-2">
            <Card>
              <p className="t-label demo-label">Button</p>
              <div className="showcase">
                <Button>Back this project</Button>
                <Button variant="secondary">View evidence</Button>
                <Button variant="ghost">Skip</Button>
                <Button variant="oracle">Open fight</Button>
                <Button variant="crush">Celebrate</Button>
                <Button variant="danger">Cancel event</Button>
                <Button disabled>Betting closed</Button>
                <Button size="sm" variant="secondary">Small</Button>
              </div>
              <p className="t-caption" style={{ marginBottom: 0 }}>
                <code>primary</code> once per screen. <code>crush</code> is a sticker: moments only. <code>sm</code> (40px) stays out of primary flows.
              </p>
            </Card>

            <Card>
              <p className="t-label demo-label">Chip: filters vs tags</p>
              <div className="showcase" role="group" aria-label="Filter">
                {["Live", "Upcoming", "Finished", "My bets"].map((f) => (
                  <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>{f}</Chip>
                ))}
              </div>
              <div className="showcase" style={{ marginTop: 12 }}>
                <Chip tag>Next.js</Chip>
                <Chip tag>Solidity</Chip>
                <Chip tag>Base Sepolia</Chip>
              </div>
              <p className="t-caption" style={{ marginBottom: 0 }}>Filters change the view; tags do nothing. Never mix them in one row.</p>
            </Card>

            <Card>
              <p className="t-label demo-label">Status pill</p>
              <div className="showcase">
                <StatusPill tone="live">Live</StatusPill>
                <StatusPill tone="success">✓ Verified</StatusPill>
                <StatusPill tone="danger">✕ Void</StatusPill>
                <StatusPill tone="reward">⚡ +175 tokens</StatusPill>
                <StatusPill tone="neutral">Scheduled</StatusPill>
              </div>
              <p className="t-caption" style={{ marginBottom: 0 }}>Always a word. The live dot is the only thing that blinks.</p>
            </Card>

            <Card>
              <p className="t-label demo-label">Input</p>
              <div className="grid" style={{ gap: 16 }}>
                <Input id="d1" label="Stake amount" placeholder="100" help="Min 1, max 1,000 per pool." />
                <Input id="d2" label="Repository URL" defaultValue="github.com/me" error="That doesn't look like a public repository." />
              </div>
            </Card>

            <Card style={{ background: "var(--arena-canvas)", borderColor: "transparent" }}>
              <p className="t-label demo-label">Odds bar (on arena-canvas)</p>
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                  <span className="t-mono">Match #04</span>
                  <StatusPill tone="live">Live</StatusPill>
                </div>
                <OddsBar yesPct={yes} yesLabel="Atlas" noLabel="Nimbus" />
              </Card>
              <div className="showcase" style={{ marginTop: 12 }}>
                <Button size="sm" variant="secondary" onClick={() => setYes((v) => Math.min(95, v + 8))}>More on Atlas</Button>
                <Button size="sm" variant="secondary" onClick={() => setYes((v) => Math.max(5, v - 8))}>More on Nimbus</Button>
              </div>
            </Card>

            <Card>
              <p className="t-label demo-label">Progress & avatar</p>
              <div className="grid" style={{ gap: 12 }}>
                <span className="t-caption">Pool minimum 640 / 1,000</span>
                <Progress value={64} tone="reward" label="Pool minimum" />
                <span className="t-caption">Analysis: testing stage</span>
                <Progress value={40} label="Analysis progress" />
              </div>
              <div className="showcase" style={{ marginTop: 16 }}>
                <Avatar initials="AT" tint="crush-soft" />
                <Avatar initials="NB" tint="oracle-soft" />
                <Avatar initials="QZ" tint="sunny-soft" />
                <Avatar initials="—" />
              </div>
            </Card>

            <Card variant="surface" style={{ gridColumn: "1 / -1" }}>
              <p className="t-label demo-label">Card variants</p>
              <div className="grid grid-4">
                <Card><span className="t-body-strong">default</span><p className="t-caption" style={{ margin: 0 }}>canvas + line</p></Card>
                <Card variant="surface" style={{ background: "var(--surface-sunken)" }}><span className="t-body-strong">surface</span><p className="t-caption" style={{ margin: 0 }}>cream, no border</p></Card>
                <Card variant="float"><span className="t-body-strong">float</span><p className="t-caption" style={{ margin: 0 }}>shadow-soft</p></Card>
                <Card variant="sticker" style={{ background: "var(--crush-soft)" }}><span className="t-body-strong">sticker</span><p className="t-caption" style={{ margin: 0 }}>moments only</p></Card>
              </div>
            </Card>
          </div>
        </Section>

        {/* ---------------- Voice ---------------- */}
        <Section id="voice" title="Voice">
          <div className="grid grid-2">
            <div className="rule rule--do">
              <span className="tag">✓ Do</span>
              <ul className="t-body">
                <li>Second person, plain and warm, a little cheeky.</li>
                <li>Sentence case everywhere, buttons included.</li>
                <li>Buttons are a verb + object: <code>Back this project</code>, <code>Claim 175 tokens</code>.</li>
                <li>Name the mechanic in empty and locked states: <code>Pools under 10 tokens refund everyone.</code></li>
                <li>Chain detail (hashes, block times) goes in mono-caption.</li>
              </ul>
            </div>
            <div className="rule rule--dont">
              <span className="tag">✕ Don't</span>
              <ul className="t-body">
                <li>ALL CAPS, exclamation marks or emoji in UI copy.</li>
                <li><code>Submit</code>, <code>OK</code> or <code>Continue</code> on their own.</li>
                <li>Jargon like <code>Initiate settlement transaction</code>.</li>
                <li>Use danger red for a losing side. A position is not an error.</li>
                <li>Put hashes or addresses in body copy.</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* ---------------- A11y ---------------- */}
        <Section id="a11y" title="Accessibility">
          <div className="grid grid-3">
            {[
              ["Contrast", "Text meets 4.5:1 on the grounds in its usage note. Borders, focus rings and meaningful icons meet 3:1."],
              ["Focus", "2px oracle ring at 2px offset on every interactive element. Never suppress it."],
              ["Targets", "44px minimum. Default button is 52px, lg is 60px. sm (40px) stays out of primary flows."],
              ["Semantics", "Options are real radios, progress is a real progressbar, charts are role=img with the number also in text."],
              ["Not colour alone", "Yes/No, live, verified, error: always a word, usually an icon."],
              ["Reduced motion", "Under prefers-reduced-motion, presses don't scale and nothing pops. Outcomes still show."],
            ].map(([t, d]) => (
              <Card key={t}>
                <h3 className="t-heading" style={{ margin: "0 0 4px" }}>{t}</h3>
                <p className="t-caption" style={{ margin: 0 }}>{d}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* ---------------- Usage ---------------- */}
        <Section id="usage" title="How to use">
          <Card variant="surface">
            <pre className="t-mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{`// 1. Bring the tokens + component styles into your app entry
import "./design-system/tokens.css";
import "./design-system/components.css";

// 2. Use the components
import { Button, Card, StatusPill } from "./design-system/ui.jsx";

<Card>
  <StatusPill tone="live">Live</StatusPill>
  <h2 className="t-display-md">Round one</h2>
  <Button>Back this project</Button>
</Card>

// 3. Custom styles: tokens only
.my-thing {
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--surface);
  transition: transform var(--dur-fast) var(--ease-spring);
}`}</pre>
          </Card>
          <p className="t-caption" style={{ marginTop: 12 }}>
            Using Tailwind? Map these variables in <code>tailwind.config</code> theme.extend rather than retyping hex values.
          </p>
        </Section>

        <footer className="ds-footer t-caption">
          Fonts: Bricolage Grotesque, Figtree and JetBrains Mono from Google Fonts (all OFL).
        </footer>
      </main>

      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
