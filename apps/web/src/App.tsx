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
      <header className="topbar">
        <h1>voice over video generator</h1>
        <nav>
          {(Object.keys(TAB_LABEL) as TabId[]).map((tabId) => (
            <button
              key={tabId}
              className={tab === tabId ? "tab active" : "tab"}
              onClick={() => setTab(tabId)}
            >
              {TAB_LABEL[tabId]}
            </button>
          ))}
        </nav>
      </header>
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
    </main>
  );
}
