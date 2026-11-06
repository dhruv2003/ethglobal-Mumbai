/* Core components. Import from here; style only through tokens.css / components.css. */

export function Button({ variant = "primary", size, full, className = "", ...props }) {
  const cls = ["btn", `btn--${variant}`, size && `btn--${size}`, full && "btn--full", className]
    .filter(Boolean)
    .join(" ");
  return <button className={cls} {...props} />;
}

export function Chip({ selected, tag, children, ...props }) {
  if (tag) return <span className="chip chip--tag">{children}</span>;
  return (
    <button type="button" className="chip" aria-pressed={!!selected} {...props}>
      {children}
    </button>
  );
}

/** tone: live | success | danger | reward | neutral. Always carries a word. */
export function StatusPill({ tone = "neutral", children }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

/** variant: default | surface | float | sticker */
export function Card({ variant = "default", className = "", ...props }) {
  const cls = ["card", variant !== "default" && `card--${variant}`, className].filter(Boolean).join(" ");
  return <div className={cls} {...props} />;
}

export function Input({ id, label, help, error, ...props }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        aria-invalid={!!error}
        aria-describedby={help || error ? `${id}-msg` : undefined}
        {...props}
      />
      {error ? (
        <span id={`${id}-msg`} className="field__error">{error}</span>
      ) : help ? (
        <span id={`${id}-msg`} className="field__help">{help}</span>
      ) : null}
    </div>
  );
}

/** Two sides of a pool. Each side always carries its word, never colour alone. */
export function OddsBar({ yesPct, yesLabel = "Yes", noLabel = "No" }) {
  const no = 100 - yesPct;
  return (
    <div className="odds">
      <div className="odds__bar" role="img" aria-label={`${yesLabel} ${yesPct}%, ${noLabel} ${no}%`}>
        <span className="odds__yes" style={{ flexBasis: `${yesPct}%` }} />
        <span className="odds__no" style={{ flexBasis: `${no}%` }} />
      </div>
      <div className="odds__legend t-num">
        <span className="yes">{yesLabel} {yesPct}%</span>
        <span className="no">{noLabel} {no}%</span>
      </div>
    </div>
  );
}

export function Progress({ value, max = 100, tone, label }) {
  return (
    <div
      className={`progress ${tone === "reward" ? "progress--reward" : ""}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <span style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

/** tint: crush-soft | oracle-soft | sunny-soft | surface-sunken */
export function Avatar({ initials, tint = "surface-sunken", size = 48 }) {
  return (
    <span
      className="avatar"
      style={{ background: `var(--${tint})`, width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
