import { EVENT } from "../config/event.js";
import { Link } from "../lib/router.jsx";
import { BrandMark } from "./Header.jsx";

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot__inner">
        <div className="foot__brand">
          <BrandMark />
          <div>
            <span className="foot__name">Battle Arena</span>
            <span className="t-caption">Built for {EVENT.name}</span>
          </div>
        </div>
        <nav className="foot__nav" aria-label="Footer">
          <Link to="/arena">Arena</Link>
          <Link to="/tournaments">Tournaments</Link>
          <Link to="/projects">Projects</Link>
          <Link to="/judge">Judges</Link>
          <Link to="/organizer">Organizers</Link>
        </nav>
      </div>
    </footer>
  );
}
