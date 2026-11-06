import { EVENT } from "../config/event.js";
import { Link } from "../lib/router.jsx";
import { BrandMark } from "./Header.jsx";
import { Marquee } from "./fx.jsx";

const TICKER = ["Submit", "Get judged", "Fight", "Five rounds", "Three judges", "Evidence wins", ...EVENT.tracks.map((t) => t.name)];

export function Footer() {
  return (
    <footer className="foot">
      <Marquee items={TICKER} className="foot__marquee" />
      <div className="foot__inner">
        <div className="foot__brand">
          <BrandMark />
          <div>
            <span className="foot__name">Battle Arena</span>
            <span className="t-caption">Built for {EVENT.name}. Every project becomes a fighter.</span>
          </div>
        </div>
        <nav className="foot__nav" aria-label="Footer">
          <Link to="/projects">Projects</Link>
          <Link to="/submit">Submit</Link>
          <Link to="/judge">Judges</Link>
          <Link to="/organizer">Organizer</Link>
        </nav>
      </div>
    </footer>
  );
}
