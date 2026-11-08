/** A name typed as a URL ("https://app-studio.example.ai/") reads as "App Studio". */
export function cleanName(name) {
  const n = String(name ?? "").trim();
  if (!/^(https?:\/\/|www\.)/i.test(n)) return n || "Untitled";
  try {
    const host = new URL(/^https?:/i.test(n) ? n : `https://${n}`).hostname.replace(/^www\./, "");
    return host.split(".")[0].split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || n;
  } catch {
    return n;
  }
}
