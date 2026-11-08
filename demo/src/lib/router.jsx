/* Tiny History-API router: "/", "/projects", "/projects/:id". No library needed. */
import { useEffect, useState } from "react";

export function navigate(to) {
  if (to === location.pathname + location.search) return;
  history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function usePath() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

/** "/" landing, "/projects" dashboard, "/projects/:id" one project, "/submit" the form, "/judge" the judges, plus the arena and betting pages below, "/storage" what is on 0G Storage. Unknown paths land home. */
export function matchRoute(path) {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/submit") return { name: "tournaments", rewrite: "/tournaments" }; // you enter through a tournament
  if (p === "/wallet") return { name: "wallet" };
  if (p === "/wallet/transactions") return { name: "transactions" };
  if (p === "/organizer") return { name: "organizer" };
  if (p === "/arena") return { name: "arena" };
  if (p === "/graph") return { name: "graph" };
  if (p === "/rankings" || p === "/leaderboard") return { name: "rankings" };
  if (p === "/tournaments") return { name: "tournaments" };
  const entering = p.match(/^\/tournaments\/([^/]+)\/submit$/);
  if (entering) return { name: "form", eventId: decodeURIComponent(entering[1]) };
  const tournament = p.match(/^\/tournaments\/([^/]+)$/);
  if (tournament) return { name: /^\d+$/.test(tournament[1]) ? "tournament" : "event", id: decodeURIComponent(tournament[1]) };
  const fight = p.match(/^\/fights\/([^/]+)\/(\d+)$/);
  if (fight) return { name: "matchFight", id: decodeURIComponent(fight[1]), match: Number(fight[2]) };
  if (p === "/judge" || p === "/judges") return { name: "judges" };
  if (p === "/projects") return { name: "projects" };
  if (p === "/storage") return { name: "storage" };
  const m = p.match(/^\/projects\/([^/]+)$/);
  if (m) return { name: "project", id: decodeURIComponent(m[1]) };
  return { name: "home", canonical: p === "/" };
}

/** Rewrite an unknown path to "/" without adding history. */
export function useCanonical(route) {
  useEffect(() => {
    if (route.name === "home" && !route.canonical) history.replaceState({}, "", "/");
    if (route.rewrite) history.replaceState({}, "", route.rewrite);
  }, [route.name, route.canonical, route.rewrite]);
}

/** <Link> that routes in-app but stays a real link (new tab, copy URL). */
export function Link({ to, onClick, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
