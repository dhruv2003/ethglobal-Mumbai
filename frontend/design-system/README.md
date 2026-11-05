# Design system: Playful Minimal

One page that documents the project's visual language: colour, type, spacing, shape, motion, the core components, voice and accessibility rules.

## Run it

```bash
cd frontend/design-system
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Files

| File | What it is |
| --- | --- |
| `src/tokens.css` | **Source of truth.** Every colour, space, radius, shadow, duration, easing and type style. |
| `src/components.css` | Styles for the core components, built only from tokens. |
| `src/ui.jsx` | React components: `Button`, `Chip`, `StatusPill`, `Card`, `Input`, `OddsBar`, `Progress`, `Avatar`. |
| `src/DesignSystemPage.jsx` | The documentation page. |
| `src/page.css` | Layout for the doc page only. Not part of the system. |

## The rules

1. Never hard-code a value. Use `var(--token)`. If a value is missing, add a token to `tokens.css` first.
2. There are three colours, and each has one job: **crush** for people, **oracle** for the protocol, **sunny** for tokens and rewards.
3. Keep surfaces flat by default. The sticker (2px ink border plus `--shadow-pop`) is for moments only.
4. Use one primary button per screen.
5. Never rely on colour alone. Every state carries a word.
6. Wrap every animation so it respects `prefers-reduced-motion`.

To reuse in the app, copy `tokens.css`, `components.css` and `ui.jsx` into it and import the two CSS files once at the entry point.
