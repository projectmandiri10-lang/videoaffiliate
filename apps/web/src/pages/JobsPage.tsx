import { useEffect, useMemo, useState } from "react";
import {
  fetchJobDetail,
  fetchJobs,
  retryStyle,
  toAbsoluteOutputUrl
} from "../api";
import { StatusBadge } from "../components/StatusBadge";
import type { JobRecord, StyleId } from "../types";

const STYLE_LABEL: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Problem-Solution"
};

export function JobsPage() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copyInfo, setCopyInfo] = useState("");

  const refreshJobs = async () => {
    try {
      setLoading(true);
      const list = await fetchJobs();
      setJobs(list);
      const firstJob = list[0];
      if (!selectedJobId && firstJob) {
        setSelectedJobId(firstJob.jobId);
      }
      setError("");
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const refreshDetail = async (jobId: string) => {
    try {
      const detail = await fetchJobDetail(jobId);
      setSelectedJob(detail);
      setError("");
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  };

  useEffect(() => {
    void refreshJobs();
  }, []);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }
    void refreshDetail(selectedJobId);
    const timer = setInterval(() => {
      void refreshDetail(selectedJobId);
      void refreshJobs();
    }, 5000);
    return () => clearInterval(timer);
  }, [selectedJobId]);

  const selected = useMemo(
    () => selectedJob ?? jobs.find((item) => item.jobId === selectedJobId) ?? null,
    [jobs, selectedJob, selectedJobId]
  );

  const onRetry = async (styleId: StyleId) => {
    if (!selected) {
      return;
    }
    try {
      await retryStyle(selected.jobId, styleId);
      await refreshDetail(selected.jobId);
      await refreshJobs();
    } catch (retryError) {
      setError((retryError as Error).message);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyInfo("Caption siap upload berhasil disalin.");
      setTimeout(() => setCopyInfo(""), 2000);
    } catch (copyError) {
      setError((copyError as Error).message);
    }
  };

  const getOutputLinks = (
    style: JobRecord["styles"][number]
  ): Array<{ label: string; href: string }> => {
    const links: Array<{ label: string; href: string }> = [];
    if (style.srtPath) {
      links.push({ label: "SRT", href: toAbsoluteOutputUrl(style.srtPath) });
    }
    if (style.wavPath) {
      links.push({ label: "WAV", href: toAbsoluteOutputUrl(style.wavPath) });
    }
    if (style.mp4Path) {
      links.push({ label: "MP4", href: toAbsoluteOutputUrl(style.mp4Path) });
    }
    if (style.captionPath) {
      links.push({
        label: "Caption TXT",
        href: toAbsoluteOutputUrl(style.captionPath)
      });
    }
    return links;
  };

  const composeCaptionForCopy = (
    style: JobRecord["styles"][number],
    jobAffiliateLink?: string
  ): string => {
    const blocks = [
      style.captionText ?? "",
      style.hashtags?.join(" ") ?? "",
      jobAffiliateLink?.trim() ?? ""
    ].filter((value) => value.length > 0);
    return blocks.join("\n\n");
  };

  return (
    <section className="card split-layout">
      <div>
        <div className="row-head">
          <h2>Jobs</h2>
          <button onClick={refreshJobs} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="job-list">
          {jobs.map((job) => (
            <button
              key={job.jobId}
              className={`job-item ${job.jobId === selectedJobId ? "active" : ""}`}
              onClick={() => {
                setSelectedJobId(job.jobId);
                void refreshDetail(job.jobId);
              }}
            >
              <div className="break-anywhere">{job.title}</div>
              <div className="small break-anywhere">#{job.jobId}</div>
              <StatusBadge status={job.overallStatus} />
            </button>
          ))}
          {!jobs.length && <p>Belum ada job.</p>}
        </div>
      </div>
      <div>
        <h3>Detail Job</h3>
        {!selected && <p>Pilih job untuk melihat detail.</p>}
        {selected && (
          <div className="detail-box">
            <p>
              <strong>Judul:</strong> {selected.title}
            </p>
            <p>
              <strong>Durasi:</strong> {selected.videoDurationSec.toFixed(2)} detik
            </p>
            <p>
              <strong>Status:</strong> <StatusBadge status={selected.overallStatus} />
            </p>
            <p>
              <strong>Affiliate Link:</strong>{" "}
              {selected.affiliateLink ? (
                <span className="break-anywhere">{selected.affiliateLink}</span>
              ) : (
                <span className="small">Tidak tersedia</span>
              )}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Style</th>
                    <th>Status</th>
                    <th>Output</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.styles.map((style) => {
                    const outputLinks = getOutputLinks(style);
                    return (
                      <tr key={style.styleId}>
                        <td>{STYLE_LABEL[style.styleId]}</td>
                        <td>
                          <StatusBadge status={style.status} />
                          {style.errorMessage && (
                            <div className="err-inline break-anywhere">{style.errorMessage}</div>
                          )}
                        </td>
                        <td>
                          <div className="small">
                            {outputLinks.length
                              ? `Tersedia: ${outputLinks.map((item) => item.label).join(", ")}`
                              : "Belum ada file output"}
                          </div>
                          {outputLinks.length > 0 && (
                            <div className="output-links">
                              {outputLinks.map((output) => (
                                <a
                                  key={output.label}
                                  href={output.href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {output.label}
                                </a>
                              ))}
                            </div>
                          )}
                          {(style.captionText || style.hashtags?.length) && (
                            <div className="caption-box">
                              {style.captionText && <p className="break-anywhere">{style.captionText}</p>}
                              {style.hashtags?.length ? (
                                <p className="small break-anywhere">{style.hashtags.join(" ")}</p>
                              ) : null}
                              {selected.affiliateLink && (
                                <p className="small break-anywhere">{selected.affiliateLink}</p>
                              )}
                              <button
                                onClick={() =>
                                  void copyToClipboard(
                                    composeCaptionForCopy(style, selected.affiliateLink)
                                  )
                                }
                              >
                                Copy Caption
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          {(style.status === "failed" || style.status === "interrupted") && (
                            <button onClick={() => void onRetry(style.styleId)}>Retry</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {copyInfo && <p className="ok-text">{copyInfo}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
