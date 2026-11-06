/*
 * Small feedback pieces used across pages.
 * - Spinner: a circular loader. Under reduced motion it stands still; the label
 *   next to it always says what is happening, so it never relies on motion.
 * - Toasts: toast("Saved") from anywhere; <Toaster /> renders them once in App.
 */
import { useEffect, useState } from "react";

export function Spinner({ size = 20, label = "Loading" }) {
  return <span className="spinner" style={{ "--size": `${size}px` }} role="img" aria-label={label} />;
}

const EVENT = "arena:toast";
export function toast(message, { tone = "success", ms = 4500 } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: Date.now() + Math.random(), message, tone, ms } }));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const t = e.detail;
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.ms);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-card toast-card--${t.tone}`}>
          <span className="toast-card__mark" aria-hidden="true">
            {t.tone === "success" ? "✓" : "!"}
          </span>
          <span>{t.message}</span>
          <button type="button" className="toast-card__x" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
