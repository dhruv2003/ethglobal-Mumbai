import { useEffect, useRef, useState } from "react";
import { Progress } from "@ds/ui.jsx";
import { SECTIONS } from "../lib/validate.js";

export const scrollToId = (id) => {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

/** Every status is a word, never colour alone. */
export function SideNav({ statuses, savedAt, progress }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const listRef = useRef(null);

  // Track every section's visibility, not just the ones that changed, and
  // highlight the first visible one in page order.
  useEffect(() => {
    const visible = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)));
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-150px 0px -50% 0px" },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    // The last section is too short to reach the active zone; at the bottom, it wins.
    const onScroll = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) setActive(SECTIONS.at(-1).id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // On phones the nav is a horizontal strip: keep the active item in view.
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector(`a[href="#${active}"]`);
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: link.offsetLeft - list.offsetLeft - 16, behavior: "auto" });
  }, [active]);

  return (
    <nav className="side" aria-label="Form sections">
      <ul ref={listRef}>
        {SECTIONS.map((s) => {
          const st = statuses[s.id];
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={active === s.id ? "cur" : ""}
                aria-current={active === s.id ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId(s.id);
                }}
              >
                <span>{s.title}</span>
                <small className={st.done ? "done" : ""}>{st.label}</small>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="side__meta">
        <span className="t-caption">{savedAt ? `Draft saved ${savedAt}` : "Drafts save as you type"}</span>
        <Progress value={progress} label="Form progress" />
      </div>
    </nav>
  );
}
