/* Shared CSS-3D stage: perspective-illusion camera, planes and billboards. */

// Fritsch–Carlson monotone cubic, so camera speed never jumps between keys.
export function monotone(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * keys: [frame, perspective, yaw, elevation, scale, pivotX, pivotY, pivotZ]
 * Perspective is interpolated in log space (a huge value = flat telephoto look).
 */
export function makeCamera(keys) {
  const xs = keys.map((k) => k[0]);
  const curves = [1, 2, 3, 4, 5, 6, 7].map((c) => monotone(xs, keys.map((k) => (c === 1 ? Math.log(k[c]) : k[c] ?? 0))));
  return (f) => {
    const [lp, yaw, el, s, px, py, pz] = curves.map((fn) => fn(f));
    return { P: Math.exp(lp), yaw, el, s, px, py, pz };
  };
}

export const worldTransform = (cam, extraScale = 1, sh = { x: 0, y: 0 }) => {
  const s = cam.s * extraScale;
  return `translate(${sh.x}px,${sh.y}px) scale3d(${s},${s},${s}) rotateX(${-cam.el}deg) rotateY(${cam.yaw}deg) translate3d(${-cam.px}px,${-cam.py}px,${-cam.pz}px)`;
};

export const camSpeed = (cam, prev) => Math.abs(cam.yaw - prev.yaw) + Math.abs(Math.log(cam.P / prev.P)) * 25 + Math.abs(cam.el - prev.el);

// A plane centred on (x,y,z); `rot` orients it (e.g. "rotateX(90deg)" for the floor).
export const Plane = ({ x = 0, y = 0, z = 0, w, h, rot = "", style, children }) => (
  <div style={{ position: "absolute", left: -w / 2, top: -h / 2, width: w, height: h, transform: `translate3d(${x}px,${y}px,${z}px) ${rot}`, ...style }}>{children}</div>
);

// Upright card that always faces the camera; (x,y,z) is its foot.
export const BB = ({ x, y, z, yaw, children, extra = "", anchor = "translate(-50%,-100%)" }) => (
  <div style={{ position: "absolute", left: 0, top: 0, transformStyle: "preserve-3d", transform: `translate3d(${x}px,${y}px,${z}px) rotateY(${-yaw}deg) ${extra}` }}>
    <div style={{ position: "absolute", transform: anchor }}>{children}</div>
  </div>
);
