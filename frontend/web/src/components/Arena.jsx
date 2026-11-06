/*
 * The ring: a small piece of set dressing every fighter stands in.
 * Back ropes, two corner posts, a mat. Arena-canvas ground (protocol room),
 * ink posts, oracle mat. Purely decorative: aria-hidden.
 */
export function Ring({ children, className = "", compact = false, style }) {
  return (
    <div className={`ring ${compact ? "ring--compact" : ""} ${className}`} style={style}>
      <div className="ring__set" aria-hidden="true">
        <span className="ring__post ring__post--l" />
        <span className="ring__post ring__post--r" />
        <span className="ring__rope ring__rope--1" />
        <span className="ring__rope ring__rope--2" />
        <span className="ring__rope ring__rope--3" />
        <span className="ring__mat" />
      </div>
      <div className="ring__floor">{children}</div>
    </div>
  );
}
