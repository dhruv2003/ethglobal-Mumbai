import { useCallback, useEffect, useMemo, useState } from "react";
import { FormCtx, fieldId } from "./components/fields.jsx";
import { Header } from "./components/Header.jsx";
import { SideNav, scrollToId } from "./components/SideNav.jsx";
import { Success } from "./components/Success.jsx";
import { EVENT } from "./config/event.js";
import { emptyForm, getIn, mergeDraft, setIn } from "./lib/form.js";
import { clearDraft, loadDraft, saveDraft, saveSubmission, toPayload } from "./lib/storage.js";
import { SECTIONS, sectionErrorKeys, validate } from "./lib/validate.js";
import { useWallet } from "./lib/wallet.js";
import { CodeSection } from "./sections/CodeSection.jsx";
import { DemoSection } from "./sections/DemoSection.jsx";
import { ProjectSection } from "./sections/ProjectSection.jsx";
import { ReviewSection } from "./sections/ReviewSection.jsx";
import { TeamSection } from "./sections/TeamSection.jsx";
import { TracksSection } from "./sections/TracksSection.jsx";

const hhmm = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Did the user type anything in this section yet? Drives "To do" vs "In progress". */
function sectionStarted(data, id) {
  switch (id) {
    case "team":
      return !!data.team.name || data.team.members.some((m) => m.name || m.github || m.role);
    case "project":
      return Object.entries(data.project).some(([, v]) => (Array.isArray(v) ? v.length : !!v));
    case "tracks":
      return data.tracks.selected.length > 0;
    case "code":
      return !!(data.code.repoUrl || data.code.ref || data.code.monorepoPath || data.code.contracts.length);
    case "demo":
      return !!(data.demo.videoUrl || data.demo.videoFile || data.demo.liveUrl || data.demo.artifacts.length);
    case "review":
      return data.consent;
    default:
      return false;
  }
}

export default function App() {
  const wallet = useWallet();
  const [data, setData] = useState(() => mergeDraft(loadDraft()));
  const [touched, setTouched] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [submitState, setSubmitState] = useState({ phase: "idle", error: "" });
  const [record, setRecord] = useState(null);

  const { errors, warnings } = useMemo(() => validate(data, { walletAddress: wallet.address }), [data, wallet.address]);

  // Autosave the draft half a second after the last change (PRD SUB-04).
  useEffect(() => {
    if (record) return undefined;
    const t = setTimeout(() => {
      if (saveDraft(data)) setSavedAt(hhmm());
    }, 500);
    return () => clearTimeout(t);
  }, [data, record]);

  const set = useCallback((path, value) => setData((d) => setIn(d, path, value)), []);
  const touch = useCallback((path) => setTouched((t) => (t[path] ? t : { ...t, [path]: true })), []);
  const get = useCallback((path) => getIn(data, path), [data]);

  const statuses = useMemo(() => {
    const out = {};
    for (const s of SECTIONS) {
      const problems = sectionErrorKeys(errors, s.id).length;
      const started = sectionStarted(data, s.id);
      let label = problems === 0 ? "✓ Done" : started ? "In progress" : "To do";
      if (s.id === "tracks") label = `${problems === 0 ? "✓ " : ""}${data.tracks.selected.length} of ${EVENT.maxTracks}`;
      out[s.id] = { done: problems === 0, problems, label };
    }
    return out;
  }, [errors, data]);

  const progress = Math.round((SECTIONS.filter((s) => statuses[s.id].done).length / SECTIONS.length) * 100);
  const problemCount = Object.keys(errors).length;

  async function submit() {
    setShowAll(true);
    setSubmitState({ phase: "idle", error: "" });
    const keys = Object.keys(errors);
    if (keys.length) {
      const el = document.getElementById(fieldId(keys[0]));
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "center" });
      } else scrollToId(keys[0].split(".")[0]);
      return;
    }
    const payload = toPayload(data, { ownerWallet: wallet.address, chainId: wallet.chainId });
    const issuedAt = new Date().toISOString();
    const message = [
      `Submit "${payload.project.name}" to ${EVENT.name} Battle Arena`,
      `Repository: ${payload.code.repoUrl}`,
      `Owner: ${wallet.address}`,
      `Issued at: ${issuedAt}`,
    ].join("\n");
    try {
      setSubmitState({ phase: "signing", error: "" });
      const signature = await wallet.sign(message);
      setSubmitState({ phase: "saving", error: "" });
      const saved = await saveSubmission({ ...payload, auth: { message, signature, issuedAt } });
      clearDraft();
      setRecord(saved);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setSubmitState({ phase: "idle", error: wallet.friendlyError(e) });
    }
  }

  function startOver() {
    setData(emptyForm());
    setTouched({});
    setShowAll(false);
    setSubmitState({ phase: "idle", error: "" });
    setRecord(null);
  }

  const ctx = { data, get, set, errors, warnings, touched, touch, showAll };

  return (
    <FormCtx.Provider value={ctx}>
      <a className="skip" href="#main">
        Skip to the form
      </a>
      <Header wallet={wallet} />
      {wallet.error && (
        <div className="banner" role="alert">
          <span>✕ {wallet.error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={wallet.clearError}>
            Dismiss
          </button>
        </div>
      )}
      {record ? (
        <main id="main" className="solo">
          <Success record={record} onStartOver={startOver} />
        </main>
      ) : (
        <div className="wrap">
          <SideNav statuses={statuses} savedAt={savedAt} progress={progress} />
          <main id="main" className="main">
            <div className="intro">
              <h1 className="t-display-lg m0">Enter your project</h1>
              <p className="t-body m0 muted">
                Your AI fighter is built from what you put here. You can edit until freeze. After that it's locked.
              </p>
            </div>
            <TeamSection wallet={wallet} />
            <ProjectSection />
            <TracksSection />
            <CodeSection />
            <DemoSection />
            <ReviewSection wallet={wallet} statuses={statuses} onSubmit={submit} submitState={submitState} problemCount={problemCount} />
          </main>
        </div>
      )}
    </FormCtx.Provider>
  );
}
