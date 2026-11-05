/* Tiny History-API router: "/", "/projects", "/projects/:id". No library needed. */
import { useEffect, useState } from "react";

export function navigate(to) {
  if (to === location.pathname) return;
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

export function matchRoute(path) {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/projects") return { name: "projects" };
  const m = p.match(/^\/projects\/([^/]+)$/);
  if (m) return { name: "project", id: decodeURIComponent(m[1]) };
  return { name: "form" };
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
