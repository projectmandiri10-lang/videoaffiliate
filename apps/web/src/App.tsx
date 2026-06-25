import { useState } from "react";
import type { JobCreationTransition } from "./job-creation";
import { GeneratePage } from "./pages/GeneratePage";
import { JobsPage } from "./pages/JobsPage";
import { TutorialPage } from "./pages/TutorialPage";

type TabId = "generate" | "jobs" | "tutorial";

const TAB_LABEL: Record<TabId, string> = {
  generate: "Buat Video",
  jobs: "Hasil",
  tutorial: "Tutorial"
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
              <p className="eyebrow">Video Affiliate</p>
              <h1>Pembuat suara video affiliate</h1>
              <p className="app-brand__copy">
                Upload video produk singkat, pilih potongan terbaik, lalu download hasil
                video dengan suara, subtitle, dan caption yang siap dipakai.
              </p>
            </div>
          </div>

          <nav className="app-nav" aria-label="Navigasi utama">
            {(Object.keys(TAB_LABEL) as TabId[]).map((tabId) => (
              <button
                key={tabId}
                className={[
                  "tab",
                  tab === tabId ? "active" : "",
                  tabId === "tutorial" ? "tab--tutorial" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
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
          {tab === "tutorial" && <TutorialPage />}
        </section>

        <footer className="app-footer">
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--cyan" />
            Maksimal 30 detik
          </div>
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--violet" />
            3 pilihan potongan
          </div>
          <div className="footer-pill">Hasil tersimpan di browser ini</div>
        </footer>
      </div>
    </main>
  );
}
