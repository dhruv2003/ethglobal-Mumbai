import { useCallback, useEffect, useMemo, useState } from "react";
import { FormCtx, fieldId } from "./components/fields.jsx";
import { Header } from "./components/Header.jsx";
import { SubmissionForm } from "./components/SubmissionForm.jsx";
import { Success } from "./components/Success.jsx";
import { EVENT } from "./config/event.js";
import { emptyForm, getIn, mergeDraft, setIn } from "./lib/form.js";
import { clearDraft, loadDraft, saveDraft, saveSubmission, toPayload } from "./lib/storage.js";
import { validate } from "./lib/validate.js";
import { useWallet } from "./lib/wallet.js";
import { matchRoute, useCanonical, usePath } from "./lib/router.jsx";
import { ProjectPage, ProjectsPage } from "./components/Projects.jsx";

const hhmm = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const TITLES = { form: "Submit a project", projects: "Projects", project: "Project" };

export default function App() {
  const wallet = useWallet();
  const route = matchRoute(usePath());
  useCanonical(route);
  useEffect(() => {
    document.title = `${TITLES[route.name]} · Battle Arena`;
  }, [route.name]);
  const [data, setData] = useState(() => mergeDraft(loadDraft()));
  const [touched, setTouched] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [submitState, setSubmitState] = useState({ phase: "idle", error: "" });
  const [record, setRecord] = useState(null);

  const { errors } = useMemo(() => validate(data, { walletAddress: wallet.address }), [data, wallet.address]);
  // The wallet isn't a form field; the submit row handles it.
  const fieldErrors = Object.keys(errors).filter((k) => k !== "wallet");

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

  async function submit() {
    setShowAll(true);
    setSubmitState({ phase: "idle", error: "" });
    if (fieldErrors.length) {
      const el = document.getElementById(fieldId(fieldErrors[0]));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center" });
      return;
    }
    if (!wallet.address) return;
    const payload = toPayload(data, { ownerWallet: wallet.address, chainId: wallet.chainId });
    const issuedAt = new Date().toISOString();
    const message = [
      `Submit "${payload.project.name}" to ${EVENT.name} Battle Arena`,
      `Repository: ${payload.repoUrl}`,
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

  const ctx = { data, get, set, errors, touched, touch, showAll };

  return (
    <FormCtx.Provider value={ctx}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header wallet={wallet} route={route} />
      {wallet.error && (
        <div className="banner" role="alert">
          <span>✕ {wallet.error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={wallet.clearError}>
            Dismiss
          </button>
        </div>
      )}
      <main id="main" className={route.name === "form" ? "solo" : "solo solo--wide"}>
        {route.name === "projects" ? (
          <ProjectsPage />
        ) : route.name === "project" ? (
          <ProjectPage id={route.id} />
        ) : record ? (
          <Success record={record} onStartOver={startOver} />
        ) : (
          <>
            <div className="intro">
              <h1 className="t-display-lg m0">Enter your project</h1>
              <p className="t-body m0 muted">Seven fields. Your AI fighter is built from these and your repo.</p>
              <span className="t-caption">{savedAt ? `Draft saved ${savedAt}` : "Drafts save as you type"}</span>
            </div>
            <SubmissionForm wallet={wallet} onSubmit={submit} submitState={submitState} problemCount={fieldErrors.length} />
          </>
        )}
      </main>
    </FormCtx.Provider>
  );
}
