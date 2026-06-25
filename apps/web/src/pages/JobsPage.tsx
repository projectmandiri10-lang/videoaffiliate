import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteJob,
  downloadArtifactFile,
  reanalyzeJob,
  replaceJobSource,
  selectClip,
  shareArtifactFile
} from "../api";
import { StatusBadge } from "../components/StatusBadge";
import type { JobCreationTransition } from "../job-creation";
import { useArtifactUrl } from "../lib/use-artifact-url";
import { usePipelineState } from "../lib/use-pipeline-state";
import type { ClipCandidate, FinalRenderStatus, JobRecord, LocalArtifactRef } from "../types";

interface JobsPageProps {
  jobCreationState?: JobCreationTransition | null;
  onJobCreationStateHandled?: (requestId: number) => void;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function analysisBadgeClass(status?: JobRecord["analysisStatus"]): string {
  if (status === "done") {
    return "status status-success";
  }
  if (status === "failed" || status === "interrupted") {
    return "status status-failed";
  }
  if (status === "running") {
    return "status status-running";
  }
  return "status status-queued";
}

function renderBadgeClass(status?: FinalRenderStatus): string {
  if (status === "done") {
    return "status status-success";
  }
  if (status === "failed" || status === "interrupted") {
    return "status status-failed";
  }
  if (status === "running") {
    return "status status-running";
  }
  if (status === "pending") {
    return "status status-queued";
  }
  return "status";
}

function clipCardLabel(candidate: ClipCandidate): string {
  return `${formatTime(candidate.startSec)} - ${formatTime(candidate.endSec)}`;
}

function formatDeviceMode(mode?: JobRecord["runtime"]["deviceMode"]): string {
  return mode === "mobile_restricted" ? "Hemat mobile" : "Desktop";
}

function ArtifactVideo({ artifact, label }: { artifact?: LocalArtifactRef; label: string }) {
  const url = useArtifactUrl(artifact);
  if (!url) {
    return null;
  }
  return (
    <video
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      src={url}
      style={{ width: "100%", borderRadius: "18px" }}
    />
  );
}

export function JobsPage({
  jobCreationState = null,
  onJobCreationStateHandled
}: JobsPageProps) {
  const snapshot = usePipelineState();
  const jobs = snapshot.jobs;
  const [selectedJobId, setSelectedJobId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copyInfo, setCopyInfo] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [sourceVideo, setSourceVideo] = useState<File | null>(null);
  const selectedJobIdRef = useRef("");

  const selected = useMemo(() => {
    if (!jobs.length) {
      return null;
    }
    return jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0] ?? null;
  }, [jobs, selectedJobId]);

  useEffect(() => {
    if (selected) {
      setSelectedJobId(selected.jobId);
    } else if (!jobs.length) {
      setSelectedJobId("");
    }
  }, [jobs.length, selected?.jobId]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  useEffect(() => {
    if (!jobCreationState) {
      return;
    }
    if (jobCreationState.phase === "created" && jobCreationState.jobId) {
      setMessage(`Job ${jobCreationState.jobId} sedang diproses.`);
      setError("");
      setSelectedJobId(jobCreationState.jobId);
      onJobCreationStateHandled?.(jobCreationState.requestId);
      return;
    }
    if (jobCreationState.phase === "failed") {
      setError(jobCreationState.error ?? "Gagal membuat job.");
      onJobCreationStateHandled?.(jobCreationState.requestId);
    }
  }, [jobCreationState, onJobCreationStateHandled]);

  const onSelectClip = async (jobId: string, clipId: string) => {
    try {
      setActionKey(`select:${clipId}`);
      setError("");
      setMessage("");
      await selectClip(jobId, clipId);
      setMessage("Pilihan video disimpan. Hasil akhir sedang dibuat.");
    } catch (selectError) {
      setError((selectError as Error).message);
    } finally {
      setActionKey("");
    }
  };

  const onReanalyze = async (jobId: string) => {
    try {
      setActionKey(`reanalyze:${jobId}`);
      setError("");
      setMessage("");
      await reanalyzeJob(jobId);
      setMessage("Video dijadwalkan untuk diproses ulang.");
    } catch (reanalyzeError) {
      setError((reanalyzeError as Error).message);
    } finally {
      setActionKey("");
    }
  };

  const onReplaceSource = async (jobId: string) => {
    if (!sourceVideo) {
      setError("Pilih video baru terlebih dulu.");
      return;
    }

    try {
      setActionKey(`source:${jobId}`);
      setError("");
      setMessage("");
      await replaceJobSource(jobId, sourceVideo);
      setSourceVideo(null);
      setMessage("Video baru tersimpan dan langsung diproses ulang.");
    } catch (replaceError) {
      setError((replaceError as Error).message);
    } finally {
      setActionKey("");
    }
  };

  const onDelete = async (jobId: string) => {
    try {
      setActionKey(`delete:${jobId}`);
      setError("");
      setMessage("");
      await deleteJob(jobId);
      setMessage("Video berhasil dihapus.");
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setActionKey("");
    }
  };

  const copyCaption = async (job: JobRecord) => {
    const caption = [
      job.finalRender?.captionText ?? "",
      job.finalRender?.hashtags?.join(" ") ?? "",
      job.affiliateLink ?? ""
    ]
      .filter((value) => value.length > 0)
      .join("\n\n");
    if (!caption) {
      return;
    }
    try {
      await navigator.clipboard.writeText(caption);
      setCopyInfo("Caption berhasil disalin.");
      setTimeout(() => setCopyInfo(""), 2000);
    } catch (copyError) {
      setError((copyError as Error).message);
    }
  };

  const onShare = async () => {
    if (!selected?.finalRender?.mp4Path) {
      return;
    }
    try {
      const shared = await shareArtifactFile(selected.finalRender.mp4Path);
      if (!shared) {
        setMessage("Browser ini belum mendukung berbagi file. Gunakan download.");
      }
    } catch (shareError) {
      setError((shareError as Error).message);
    }
  };

  return (
    <section className="page-shell jobs-page">
      <aside className="jobs-sidebar glass-panel">
        <div className="jobs-sidebar__head">
          <div>
            <div className="page-kicker">
              <i className="ti ti-stack-2" />
              <span>Proses</span>
            </div>
            <p className="eyebrow">Hasil Video</p>
            <h2>Daftar video yang sedang diproses</h2>
            <p className="page-intro">
              Semua hasil tersimpan di browser ini. Jangan tutup tab saat proses masih berjalan.
            </p>
          </div>
          <div className="meta-grid">
            <div className="meta-card">
              <strong>Total Video</strong>
              <div>{jobs.length}</div>
            </div>
            <div className="meta-card">
              <strong>Penyimpanan</strong>
              <div>Browser ini</div>
            </div>
          </div>
        </div>

        <div className="job-list">
          {jobCreationState?.phase === "uploading" && (
            <div className="job-item active">
              <div className="job-item__row">
                <strong>Mengirim video baru</strong>
                <span className="small">{jobCreationState.title}</span>
              </div>
              <div
                className="job-progress-track"
                role="progressbar"
                aria-label={`Upload job ${jobCreationState.title}`}
              >
                <div className="job-progress-fill is-indeterminate" />
              </div>
            </div>
          )}

          {jobs.map((job) => (
            <button
              key={job.jobId}
              type="button"
              className={`job-item ${selected?.jobId === job.jobId ? "active" : ""}`}
              onClick={() => setSelectedJobId(job.jobId)}
            >
              <div className="job-item__row">
                <strong>{job.title}</strong>
                <StatusBadge status={job.overallStatus} />
              </div>
              <div className="job-item__meta">
                <span>{job.clipCandidates?.length ?? 0} pilihan</span>
                <span>{job.videoDurationSec.toFixed(1)} detik</span>
              </div>
            </button>
          ))}

          {!jobs.length && jobCreationState?.phase !== "uploading" && (
            <div className="empty-state">
              <i className="ti ti-database-off" aria-hidden="true" />
              <p>Belum ada video untuk ditampilkan.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="jobs-main">
        {selected ? (
          <>
            <div className="detail-box glass-panel">
              <div className="meta-grid">
                <div className="meta-card">
                  <strong>Judul</strong>
                  <div className="break-anywhere">{selected.title}</div>
                </div>
                <div className="meta-card">
                  <strong>Status awal</strong>
                  <span className={analysisBadgeClass(selected.analysisStatus)}>
                    {selected.analysisStatus ?? "pending"}
                  </span>
                </div>
                <div className="meta-card">
                  <strong>Hasil video</strong>
                  <span className={renderBadgeClass(selected.finalRender?.status)}>
                    {selected.finalRender?.status ?? "idle"}
                  </span>
                </div>
                <div className="meta-card">
                  <strong>Mode</strong>
                  <div>{formatDeviceMode(selected.runtime?.deviceMode)}</div>
                </div>
              </div>

              <div className="detail-summary">
                <div className="detail-summary__copy">
                  <strong>Affiliate Link</strong>
                  <span className="break-anywhere">{selected.affiliateLink}</span>
                </div>
                <div className="detail-summary__copy">
                  <strong>Status proses</strong>
                  <span className="break-anywhere">{selected.runtime.statusMessage}</span>
                </div>
              </div>

              {(selected.overallStatus === "running" ||
                selected.analysisStatus === "running" ||
                selected.finalRender?.status === "running") && (
                <div className="progress-panel">
                  <strong>{selected.runtime.stage}</strong>
                  <div className="job-progress-track">
                    <div
                      className="job-progress-fill"
                      style={{ width: `${Math.max(6, Math.round(selected.runtime.progress * 100))}%` }}
                    />
                  </div>
                  <p className="small">{selected.runtime.lastWorkerLog || selected.runtime.statusMessage}</p>
                </div>
              )}

              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onReanalyze(selected.jobId)}
                  disabled={actionKey === `reanalyze:${selected.jobId}`}
                >
                  {actionKey === `reanalyze:${selected.jobId}` ? "Menjadwalkan..." : "Proses Ulang"}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void onDelete(selected.jobId)}
                  disabled={actionKey === `delete:${selected.jobId}`}
                >
                  {actionKey === `delete:${selected.jobId}` ? "Menghapus..." : "Hapus Video"}
                </button>
              </div>
            </div>

            <div className="section-card glass-panel">
              <div className="row-head">
                <div>
                  <p className="eyebrow">Pilihan Potongan</p>
                  <h3>Pilih potongan video terbaik</h3>
                </div>
                {selected.selectedClipId && (
                  <div className="small">Pilihan aktif: {selected.selectedClipId}</div>
                )}
              </div>

              {selected.analysisErrorMessage && (
                <p className="err-text break-anywhere">{selected.analysisErrorMessage}</p>
              )}

              {selected.runtime.interruptReason && (
                <p className="err-text break-anywhere">{selected.runtime.interruptReason}</p>
              )}

              <div className="platform-run-list">
                {(selected.clipCandidates ?? []).map((candidate) => (
                  <article key={candidate.clipId} className="platform-run-card">
                    <div className="platform-run-card__head">
                      <div>
                        <h4>{candidate.clipId}</h4>
                        <div className="small">
                          {clipCardLabel(candidate)} - {candidate.durationSec.toFixed(1)} detik
                        </div>
                        <div className="small">Skor {candidate.score.toFixed(1)}</div>
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void onSelectClip(selected.jobId, candidate.clipId)}
                        disabled={
                          Boolean(actionKey) ||
                          selected.finalRender?.status === "running" ||
                          selected.analysisStatus === "running"
                        }
                      >
                        {actionKey === `select:${candidate.clipId}` ? "Menyiapkan..." : "Pilih Hasil Ini"}
                      </button>
                    </div>

                    <ArtifactVideo artifact={candidate.previewPath} label={`Preview ${candidate.clipId}`} />
                    <p className="small break-anywhere">{candidate.reason}</p>
                  </article>
                ))}

                {selected.analysisStatus === "running" && (
                  <div className="progress-panel">
                    <strong>Analisis sedang berjalan</strong>
                    <div className="job-progress-track">
                      <div
                        className="job-progress-fill"
                        style={{ width: `${Math.max(6, Math.round(selected.runtime.progress * 100))}%` }}
                      />
                    </div>
                    <p className="small">
                      Sistem sedang menilai video dan menyiapkan pilihan potongan terbaik.
                    </p>
                  </div>
                )}

                {selected.analysisStatus !== "running" && !(selected.clipCandidates?.length) && (
                  <div className="empty-state">
                    <i className="ti ti-movie-off" aria-hidden="true" />
                    <p>Belum ada pilihan potongan untuk video ini.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="section-card glass-panel">
              <div className="row-head">
                <div>
                  <p className="eyebrow">Hasil Akhir</p>
                  <h3>Video siap diunduh</h3>
                </div>
                <span className={renderBadgeClass(selected.finalRender?.status)}>
                  {selected.finalRender?.status ?? "idle"}
                </span>
              </div>

              {selected.finalRender?.errorMessage && (
                <p className="err-text break-anywhere">{selected.finalRender.errorMessage}</p>
              )}

              {selected.finalRender?.mp4Path ? (
                <div className="platform-run-list">
                  <ArtifactVideo artifact={selected.finalRender.mp4Path} label="Output final" />

                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void downloadArtifactFile(selected.finalRender?.mp4Path)}
                    >
                      Download MP4
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void downloadArtifactFile(selected.finalRender?.srtPath)}
                    >
                      Download SRT
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void downloadArtifactFile(selected.finalRender?.captionPath)}
                    >
                      Download Caption
                    </button>
                    <button type="button" className="secondary-button" onClick={() => void onShare()}>
                      Bagikan
                    </button>
                  </div>

                  <div className="caption-box">
                    {selected.finalRender.captionText ? (
                      <p className="break-anywhere">{selected.finalRender.captionText}</p>
                    ) : (
                      <p className="small">Caption final belum tersedia.</p>
                    )}
                    {selected.finalRender.hashtags?.length ? (
                      <p className="small break-anywhere">{selected.finalRender.hashtags.join(" ")}</p>
                    ) : null}
                    {selected.affiliateLink && (
                      <p className="small break-anywhere">{selected.affiliateLink}</p>
                    )}
                    <button type="button" className="secondary-button" onClick={() => void copyCaption(selected)}>
                      Copy Caption
                    </button>
                  </div>
                </div>
              ) : selected.finalRender?.status === "running" || selected.finalRender?.status === "pending" ? (
                <div className="progress-panel">
                  <strong>Video akhir sedang dibuat</strong>
                  <div className="job-progress-track">
                    <div
                      className="job-progress-fill"
                      style={{ width: `${Math.max(6, Math.round(selected.runtime.progress * 100))}%` }}
                    />
                  </div>
                  <p className="small">Sistem sedang menyusun video, suara, dan subtitle.</p>
                </div>
              ) : (
                <div className="empty-state">
                  <i className="ti ti-video-off" aria-hidden="true" />
                  <p>Pilih salah satu potongan video untuk membuat hasil akhir.</p>
                </div>
              )}
            </div>

            <div className="section-card glass-panel">
              <div className="row-head">
                <div>
                  <p className="eyebrow">Video Sumber</p>
                  <h3>Ganti video</h3>
                </div>
              </div>
              <div className="grid-form">
                <label className="form-field">
                  <span className="field-kicker">Video Baru</span>
                  <input
                    aria-label="Video Baru"
                    type="file"
                    accept="video/*"
                    onChange={(event) => setSourceVideo(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void onReplaceSource(selected.jobId)}
                  disabled={actionKey === `source:${selected.jobId}`}
                >
                  {actionKey === `source:${selected.jobId}` ? "Mengganti..." : "Ganti Video"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="detail-box glass-panel">
            <div className="empty-state">
              <i className="ti ti-database-off" aria-hidden="true" />
              <p>Belum ada video aktif untuk ditampilkan.</p>
            </div>
          </div>
        )}

        {copyInfo && <p className="ok-text">{copyInfo}</p>}
        {message && <p className="ok-text">{message}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
