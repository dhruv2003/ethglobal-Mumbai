/* Line icons for the review pipeline and the testing tab: 24px grid, stroke follows currentColor. */

const ICONS = {
  code: <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
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
