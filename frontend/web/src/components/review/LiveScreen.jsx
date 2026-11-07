import { useEffect, useState } from "react";
import { api, apiUrl } from "../../lib/api.js";
import { Spinner } from "../Feedback.jsx";
import { API } from "../../lib/apiBase.js";

/**
 * The cloud browser's screen, live, while its test runs: an MJPEG stream the
 * backend serves from the newest screencast frame. Reconnects when frames
 * start (the browser takes a few seconds to come up).
 */
export function LiveScreen({ projectId, device, label = device }) {
  const [on, setOn] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const r = await api(`/projects/${encodeURIComponent(projectId)}/live/now`).catch(() => null);
      if (!alive) return;
      setOn((was) => {
        if (r?.[device] && !was) setN((k) => k + 1); // (re)connect when frames appear
        return Boolean(r?.[device]);
      });
    };
    check();
    const t = setInterval(check, 3000);
    // Demo: the "stream" is the run's step screenshots, advanced like a screencast.
    const frames = setInterval(() => setN((k) => k + 1), 1400);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(frames);
    };
  }, [projectId, device]);
  return (
    <div className={`screen screen--${device}`}>
      {on ? (
        <img key={n} src={apiUrl(`/api/projects/${encodeURIComponent(projectId)}/live/stream/${device}?n=${n}`)} alt={`Live view of the ${label} test device`} />
      ) : (
        <span className="screen__wait">
          <Spinner size={18} label="Starting" /> Starting the {label}…
        </span>
      )}
      {on && (
        <span className="screen__live">
          <span aria-hidden="true">●</span> LIVE
        </span>
      )}
    </div>
  );
}
