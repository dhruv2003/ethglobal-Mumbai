/* Line icons for the review pipeline and the testing tab: 24px grid, stroke follows currentColor. */

const ICONS = {
  code: <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  contract: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  browser: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5M8 10.5l1.8 1.8L13.5 8.6" />
    </>
  ),
  gavel: (
    <>
      <path d="m13.5 4.5 6 6M10.5 7.5l6 6M12 6l-4.5 4.5 6 6L18 12" />
      <path d="M9.5 14.5 3.5 20.5M3 21h9" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" />
      <path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z" />
    </>
  ),
  flow: (
    <>
      <circle cx="5" cy="7" r="2.5" />
      <circle cx="5" cy="17" r="2.5" />
      <circle cx="19" cy="12" r="2.5" />
      <path d="M7.5 7c4 0 4 5 9 5M7.5 17c4 0 4-5 9-5" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="4.5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M12 18h.01" />
    </>
  ),
};
export function Icon({ name, size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** The test devices' platforms, as their logos (filled, brand colour). os: "windows" | "android" | "ios". */
const OS = {
  // Our live tests run cloud Chrome at laptop and phone sizes: plain device marks, no OS claimed.
  desktop: {
    color: "#3d3a4a",
    label: "Laptop (Chrome)",
    body: (
      <>
        <path d="M4 5h16a1 1 0 0 1 1 1v9H3V6a1 1 0 0 1 1-1Zm1 2v6h14V7H5Z" />
        <path d="M1 17h22v1.2A1.8 1.8 0 0 1 21.2 20H2.8A1.8 1.8 0 0 1 1 18.2V17Z" />
      </>
    ),
  },
  mobile: {
    color: "#3d3a4a",
    label: "Phone (Chrome)",
    body: (
      <>
        <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h8V5H8Z" />
        <circle cx="12" cy="20" r="1" />
      </>
    ),
  },
  windows: {
    color: "#0078d4",
    label: "Windows",
    body: (
      <>
        <rect x="3" y="3" width="8.4" height="8.4" />
        <rect x="12.6" y="3" width="8.4" height="8.4" />
        <rect x="3" y="12.6" width="8.4" height="8.4" />
        <rect x="12.6" y="12.6" width="8.4" height="8.4" />
      </>
    ),
  },
  android: {
    color: "#3ddc84",
    label: "Android",
    body: (
      <>
        <path d="M3.5 18a8.5 8.5 0 0 1 17 0z" />
        <path d="M6.8 8.6 5 5.6M17.2 8.6 19 5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8.6" cy="14.2" r="1.05" fill="#fff" />
        <circle cx="15.4" cy="14.2" r="1.05" fill="#fff" />
      </>
    ),
  },
  ios: {
    color: "currentColor",
    label: "iOS",
    body: (
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8C6.9 7.5 5.4 8.4 4.6 9.8c-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.3c.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.3-3.8zM14.1 5.9c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.6 1.4-.6.6-1.1 1.7-.9 2.7 1 .1 2-.5 2.5-1.3z" />
    ),
  },
};
export const osOf = (run) => run?.os ?? ({ laptop: "desktop", phone: "mobile", android: "android", ios: "ios" }[run?.device] ?? "desktop");
export function OsLogo({ os, size = 16 }) {
  const o = OS[os] ?? OS.windows;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={o.color} style={{ color: o.color, flex: "none" }} role="img" aria-label={o.label}>
      {o.body}
    </svg>
  );
}
