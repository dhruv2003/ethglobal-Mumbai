import { useCallback, useEffect, useMemo, useState } from "react";
import { FormCtx, fieldId } from "./components/fields.jsx";
import { Header } from "./components/Header.jsx";
import { SubmissionForm } from "./components/SubmissionForm.jsx";
import { FighterPreview } from "./components/FighterPreview.jsx";
import { Toaster, toast } from "./components/Feedback.jsx";
import { EVENT } from "./config/event.js";
import { emptyForm, getIn, mergeDraft, setIn } from "./lib/form.js";
import { clearDraft, loadDraft, saveDraft, saveSubmission, submissionDigest, toPayload } from "./lib/storage.js";
import { validate } from "./lib/validate.js";
import { useWallet } from "./lib/wallet.js";
import { matchRoute, navigate, useCanonical, usePath } from "./lib/router.jsx";
import { LandingPage, ProjectPage, ProjectsPage } from "./components/Projects.jsx";
import { JudgesPage } from "./components/JudgesPage.jsx";
import { WalletPage } from "./components/WalletPage.jsx";
import { OrganizerPage } from "./components/OrganizerPage.jsx";
import { TournamentPage, TournamentsPage } from "./components/TournamentsPage.jsx";
import { ArenaPage } from "./components/ArenaPage.jsx";
import { MatchFightPage } from "./components/MatchFightPage.jsx";
import { Footer } from "./components/Footer.jsx";
import { Backdrop, ScrollProgress, easeOut } from "./components/fx.jsx";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

const hhmm = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const TITLES = {
  home: "The arena",
  form: "Submit a project",
  projects: "Projects",
  project: "Project",
  judges: "Judges",
  wallet: "Wallet",
  organizer: "Organizer",
  tournaments: "Tournaments",
  tournament: "Tournament",
  arena: "Arena",
  matchFight: "Fight",
};

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

  const { errors } = useMemo(() => validate(data, { walletAddress: wallet.address }), [data, wallet.address]);
  // The wallet isn't a form field; the submit row handles it.
  const fieldErrors = Object.keys(errors).filter((k) => k !== "wallet");

  // Autosave the draft half a second after the last change (PRD SUB-04).
  useEffect(() => {
    const t = setTimeout(() => {
      if (saveDraft(data)) setSavedAt(hhmm());
    }, 500);
    return () => clearTimeout(t);
  }, [data]);

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
      `Submission: ${await submissionDigest(payload)}`,
      `Issued at: ${issuedAt}`,
    ].join("\n");
    try {
      setSubmitState({ phase: "signing", error: "" });
      const signature = await wallet.sign(message);
      setSubmitState({ phase: "saving", error: "" });
      const saved = await saveSubmission({ ...payload, auth: { message, signature, issuedAt } });
      // Fresh form for next time, then off to the dashboard with a toast.
      clearDraft();
      startOver();
      const q = saved.review;
      toast(
        saved.savedLocallyOnly
          ? `${payload.project.name} saved on this device only: the review service is offline.`
          : q?.status === "queued" && q.ahead > 0
            ? `${payload.project.name} submitted. It's #${q.position} in the review queue.`
            : `${payload.project.name} submitted. The reviewer is on it.`,
        { tone: saved.savedLocallyOnly ? "warning" : "success", ms: 6000 },
      );
      navigate("/projects");
    } catch (e) {
      setSubmitState({ phase: "idle", error: e.fromServer ? e.message : wallet.friendlyError(e) });
    }
  }

  function startOver() {
    setData(emptyForm());
    setTouched({});
    setShowAll(false);
    setSubmitState({ phase: "idle", error: "" });
  }

  const ctx = { data, get, set, errors, touched, touch, showAll };

  const pageClass = `page ${route.name === "form" ? "solo solo--form" : route.name === "arena" ? "village-main" : route.name === "matchFight" || route.name === "tournament" ? "solo solo--arena" : "solo solo--wide"}`;

  return (
    <MotionConfig reducedMotion="user">
      <FormCtx.Provider value={ctx}>
        <Backdrop />
        <ScrollProgress />
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header wallet={wallet} route={route} />
        <Toaster />
        <AnimatePresence>
          {wallet.error && (
            <motion.div
              className="banner"
              role="alert"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: easeOut }}
            >
              <span>✕ {wallet.error}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={wallet.clearError}>
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            id="main"
            key={route.name + (route.id ?? "") + (route.match ?? "")}
            className={pageClass}
            initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.18, ease: "easeIn" } }}
            transition={{ duration: 0.5, ease: easeOut }}
          >
            {route.name === "home" ? (
              <LandingPage />
            ) : route.name === "judges" ? (
              <JudgesPage />
            ) : route.name === "wallet" ? (
              <WalletPage wallet={wallet} />
            ) : route.name === "organizer" ? (
              <OrganizerPage wallet={wallet} />
            ) : route.name === "tournaments" ? (
              <TournamentsPage />
            ) : route.name === "tournament" ? (
              <TournamentPage id={route.id} wallet={wallet} />
            ) : route.name === "arena" ? (
              <ArenaPage />
            ) : route.name === "matchFight" ? (
              <MatchFightPage id={route.id} matchIndex={route.match} wallet={wallet} />
            ) : route.name === "projects" ? (
              <ProjectsPage />
            ) : route.name === "project" ? (
              <ProjectPage id={route.id} />
            ) : (
              <>
                <div className="intro intro--form">
                  <span className="eyebrow rise">Step into the ring</span>
                  <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
                    Build your <span className="hl hl--crush">fighter</span>
                  </h1>
                  <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
                    Seven fields. Watch your fighter take shape as you fill them in.
                  </p>
                  <span className="t-caption save-state rise" style={{ "--i": 3 }} data-saved={savedAt ? "true" : "false"}>
                    <span className="save-state__dot" aria-hidden="true" />
                    {savedAt ? `Draft saved ${savedAt}` : "Drafts save as you type"}
                  </span>
                </div>
                <div className="submit-layout">
                  <SubmissionForm wallet={wallet} onSubmit={submit} submitState={submitState} problemCount={fieldErrors.length} />
                  <FighterPreview />
                </div>
              </>
            )}
          </motion.main>
        </AnimatePresence>
        {route.name !== "arena" && <Footer />}
      </FormCtx.Provider>
    </MotionConfig>
  );
}
