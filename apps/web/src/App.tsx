import { useState } from "react";
import type { JobCreationTransition } from "./job-creation";
import { GeneratePage } from "./pages/GeneratePage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";

type TabId = "generate" | "jobs" | "settings";

const TAB_LABEL: Record<TabId, string> = {
  generate: "Generate",
  jobs: "Jobs",
  settings: "Settings"
};

export default function App() {
  const [tab, setTab] = useState<TabId>("generate");
  const [jobCreationState, setJobCreationState] = useState<JobCreationTransition | null>(null);

  const handleSubmissionStateChange = (transition: JobCreationTransition) => {
    setJobCreationState(transition);
    if (transition.phase === "uploading") {
      setTab("jobs");
    }
  };

  const handleSubmissionStateHandled = (requestId: number) => {
    setJobCreationState((current) => (current?.requestId === requestId ? null : current));
  };

  return (
    <main className="app-shell">
      <div className="app-shell__backdrop" />
      <div className="app-shell__orb app-shell__orb--violet" />
      <div className="app-shell__orb app-shell__orb--cyan" />
      <div className="app-shell__grid" />

      <div className="app-frame">
        <header className="app-header glass-panel">
          <div className="app-brand">
            <div className="app-brand__mark" aria-hidden="true">
              <i className="ti ti-atom-2" />
            </div>
            <div>
              <p className="eyebrow">Automation Suite</p>
              <h1>voice over video generator</h1>
              <p className="app-brand__copy">
                Pipeline video affiliate multi-platform dengan AI narration dan output yang tetap
                bisa diakses.
              </p>
            </div>
          </div>

          <nav className="app-nav" aria-label="Navigasi utama">
            {(Object.keys(TAB_LABEL) as TabId[]).map((tabId) => (
              <button
                key={tabId}
                className={tab === tabId ? "tab active" : "tab"}
                onClick={() => setTab(tabId)}
              >
                <span className="tab__label">{TAB_LABEL[tabId]}</span>
              </button>
            ))}
          </nav>
        </header>

        <section className="app-content">
          {tab === "generate" && (
            <GeneratePage onSubmissionStateChange={handleSubmissionStateChange} />
          )}
          {tab === "jobs" && (
            <JobsPage
              jobCreationState={jobCreationState}
              onJobCreationStateHandled={handleSubmissionStateHandled}
            />
          )}
          {tab === "settings" && <SettingsPage />}
        </section>

        <footer className="app-footer">
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--cyan" />
            Outputs aman
          </div>
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--violet" />
            Jobs real-time
          </div>
          <div className="footer-pill">Build UI neon responsive</div>
        </footer>
      </div>
    </main>
  );
}
