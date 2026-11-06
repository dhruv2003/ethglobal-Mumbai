import { useCallback, useEffect, useMemo, useState } from "react";
import { FormCtx, fieldId } from "./components/fields.jsx";
import { Header } from "./components/Header.jsx";
import { SubmissionForm } from "./components/SubmissionForm.jsx";
import { FighterPreview } from "./components/FighterPreview.jsx";
import { Toaster, toast } from "./components/Feedback.jsx";
import { eventIsOpen, getEvent } from "./lib/events.js";
import { emptyForm, getIn, mergeDraft, setIn } from "./lib/form.js";
import { clearDraft, loadDraft, saveDraft, saveSubmission, submissionDigest, toPayload } from "./lib/storage.js";
import { validate } from "./lib/validate.js";
import { useWallet } from "./lib/wallet.js";
import { matchRoute, navigate, useCanonical, usePath } from "./lib/router.jsx";
import { LandingPage, ProjectPage, ProjectsPage } from "./components/Projects.jsx";
import { StoragePage } from "./components/StoragePage.jsx";
import { JudgesPage } from "./components/JudgesPage.jsx";
import { WalletPage } from "./components/WalletPage.jsx";
import { OrganizerPage } from "./components/OrganizerPage.jsx";
import { TournamentPage, TournamentsPage } from "./components/TournamentsPage.jsx";
import { EventPage } from "./components/EventPage.jsx";
import { OrganizerGate } from "./components/OrganizerGate.jsx";
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
  event: "Tournament",
  arena: "Arena",
  matchFight: "Fight",
  storage: "0G Storage",
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
  // The tournament being entered: its tracks are the only ones on the form.
  const [entering, setEntering] = useState({ loading: false, event: null });
  useEffect(() => {
    if (route.name !== "form") return undefined;
    let live = true;
    setEntering({ loading: true, event: null });
    getEvent(route.eventId).then(
      (event) => {
        if (!live) return;
        setEntering({ loading: false, event });
        setData((d) => setIn(d, "tracks.selected", d.tracks.selected.filter((id) => event.tracks.some((t) => t.id === id))));
      },
      () => live && setEntering({ loading: false, event: null }),
    );
    return () => {
      live = false;
    };
  }, [route.name, route.eventId]);
  const event = entering.event;

  const { errors } = useMemo(() => validate(data, { walletAddress: wallet.address, tracks: event?.tracks }), [data, wallet.address, event]);
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
    if (!wallet.address || !event) return;
    const payload = { ...toPayload(data, { ownerWallet: wallet.address, chainId: wallet.chainId }), eventId: event.id };
    const issuedAt = new Date().toISOString();
    const message = [
      `Submit "${payload.project.name}" to ${event.name} Battle Arena`,
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
        q?.status === "queued" && q.ahead > 0
            ? `${payload.project.name} submitted. It's #${q.position} in the review queue.`
            : `${payload.project.name} submitted. The reviewer is on it.`,
        { tone: "success", ms: 6000 },
      );
      navigate(`/projects?tournament=${encodeURIComponent(event.id)}`);
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
              <OrganizerGate wallet={wallet}><JudgesPage /></OrganizerGate>
            ) : route.name === "wallet" ? (
              <WalletPage wallet={wallet} />
            ) : route.name === "organizer" ? (
              <OrganizerGate wallet={wallet}><OrganizerPage wallet={wallet} /></OrganizerGate>
            ) : route.name === "tournaments" ? (
              <TournamentsPage wallet={wallet} />
            ) : route.name === "tournament" ? (
              <TournamentPage id={route.id} wallet={wallet} />
            ) : route.name === "event" ? (
              <EventPage id={route.id} wallet={wallet} />
            ) : route.name === "arena" ? (
              <ArenaPage />
            ) : route.name === "matchFight" ? (
              <MatchFightPage id={route.id} matchIndex={route.match} wallet={wallet} />
            ) : route.name === "projects" ? (
              <ProjectsPage wallet={wallet} />
            ) : route.name === "storage" ? (
              <StoragePage />
            ) : route.name === "project" ? (
              <ProjectPage id={route.id} wallet={wallet} />
            ) : entering.loading ? (
              <div className="skeleton skeleton--seat" aria-label="Loading tournament" />
            ) : !event || !eventIsOpen(event) ? (
              <div className="card card--surface stack">
                <h1 className="t-display-md m0">{event ? `Submissions for ${event.name} are closed` : "We couldn't find that tournament"}</h1>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate("/tournaments")}>
                  See tournaments
                </button>
              </div>
            ) : (
              <>
                <div className="intro intro--form">
                  <h1 className="t-display-lg m0 rise" style={{ "--i": 1 }}>
                    Submit to {event.name}
                  </h1>
                  <p className="t-body m0 muted rise" style={{ "--i": 2 }}>
                    Three short rounds. Your fighter levels up as you go.
                  </p>
                  <ul className="after-submit rise" style={{ "--i": 3 }} aria-label="What happens after you submit">
                    <li>
                      <span aria-hidden="true">1</span>We pin your commit
                    </li>
                    <li>
                      <span aria-hidden="true">2</span>Replay your demo on a laptop and a phone
                    </li>
                    <li>
                      <span aria-hidden="true">3</span>AI judges score it
                    </li>
                  </ul>
                  <span className="t-caption save-state rise" style={{ "--i": 4 }} data-saved={savedAt ? "true" : "false"}>
                    <span className="save-state__dot" aria-hidden="true" />
                    {savedAt ? `Draft saved ${savedAt}` : "Saves as you type"}
                  </span>
                </div>
                <div className="submit-layout">
                  <SubmissionForm tracks={event.tracks} wallet={wallet} onSubmit={submit} submitState={submitState} problemCount={fieldErrors.length} />
                  <FighterPreview eventName={event.name} />
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
