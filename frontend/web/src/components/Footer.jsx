import { Link } from "../lib/router.jsx";
import { BrandMark, SUBMIT_PATH } from "./Header.jsx";

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot__inner">
        <div className="foot__brand">
          <BrandMark />
          <div>
            <span className="foot__name">Battle Arena</span>
            <span className="t-caption">Built at ETHGlobal Mumbai</span>
          </div>
        </div>
        <nav className="foot__nav" aria-label="Footer">
          <Link to="/arena">Arena</Link>
          <Link to="/projects">Projects</Link>
          <Link to={SUBMIT_PATH}>Submit</Link>
        </nav>
      </div>
    </footer>
  );
}
