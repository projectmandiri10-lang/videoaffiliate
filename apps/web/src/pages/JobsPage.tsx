import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createJob,
  deleteJob,
  fetchJobs,
  retryPlatform,
  toAbsoluteOutputUrl,
  updateJob
} from "../api";
import type { JobCreationTransition } from "../job-creation";
import { StatusBadge } from "../components/StatusBadge";
import type { JobRecord, PlatformId } from "../types";

const PLATFORM_LABEL: Record<PlatformId, string> = {
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  facebook: "Facebook",
  shopee: "Shopee"
};

type PanelMode = "view" | "create" | "edit";

interface JobsPageProps {
  jobCreationState?: JobCreationTransition | null;
  onJobCreationStateHandled?: (requestId: number) => void;
}

interface CreateFormState {
  video: File | null;
  title: string;
  description: string;
  affiliateLink: string;
}

interface EditFormState {
  title: string;
  description: string;
  affiliateLink: string;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  video: null,
  title: "",
  description: "",
  affiliateLink: ""
};

const EMPTY_EDIT_FORM: EditFormState = {
  title: "",
  description: "",
  affiliateLink: ""
};

function isJobEditable(job: JobRecord): boolean {
  return ["queued", "failed", "interrupted"].includes(job.overallStatus);
}

function isJobDeletable(job: JobRecord): boolean {
  return job.overallStatus !== "running";
}

function getRetryCooldownMs(retryAfter?: string, nowMs = Date.now()): number {
  if (!retryAfter) {
    return 0;
  }
  const retryAtMs = Date.parse(retryAfter);
  if (!Number.isFinite(retryAtMs)) {
    return 0;
  }
  return Math.max(0, retryAtMs - nowMs);
}

function formatRetryCooldown(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function getJobProgress(job: JobRecord): {
  percent: number;
  summary: string;
  detail: string;
  isAnimated: boolean;
} {
  const total = Math.max(job.platforms.length, 1);
  const doneCount = job.platforms.filter((platform) => platform.status === "done").length;
  const runningCount = job.platforms.filter((platform) => platform.status === "running").length;
  const failedCount = job.platforms.filter(
    (platform) => platform.status === "failed" || platform.status === "interrupted"
  ).length;
  const pendingCount = total - doneCount - runningCount - failedCount;

  let percent = Math.round(((doneCount + failedCount + runningCount * 0.55) / total) * 100);
  if (job.overallStatus === "queued") {
    percent = Math.max(percent, 8);
  }
  if (job.overallStatus === "running") {
    percent = Math.max(percent, 18);
  }
  if (["success", "partial_success", "failed", "interrupted"].includes(job.overallStatus)) {
    percent = 100;
  }

  const summary =
    job.overallStatus === "queued"
      ? "Job masuk antrean dan sedang menunggu diproses."
      : job.overallStatus === "running"
        ? `Sedang memproses ${runningCount || 1} dari ${total} platform.`
        : "Job sudah mencapai status akhir.";

  const detail = `Selesai ${doneCount}, berjalan ${runningCount}, menunggu ${pendingCount}, terkendala ${failedCount}.`;

  return {
    percent: Math.min(percent, 100),
    summary,
    detail,
    isAnimated: ["queued", "running"].includes(job.overallStatus)
  };
}

export function JobsPage({
  jobCreationState = null,
  onJobCreationStateHandled
}: JobsPageProps) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [panelMode, setPanelMode] = useState<PanelMode>("view");
  const [jobsLoading, setJobsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copyInfo, setCopyInfo] = useState("");
  const [createFileInputKey, setCreateFileInputKey] = useState(0);
  const [retryClockMs, setRetryClockMs] = useState(() => Date.now());
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM);
  const selectedJobIdRef = useRef("");
  const jobCreationStateRef = useRef<JobCreationTransition | null>(jobCreationState);

  const selected = useMemo(() => {
    if (!jobs.length) {
      return null;
    }
    return jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0] ?? null;
  }, [jobs, selectedJobId]);

  const selectedProgress = useMemo(() => {
    if (!selected) {
      return null;
    }
    return getJobProgress(selected);
  }, [selected]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  useEffect(() => {
    jobCreationStateRef.current = jobCreationState;
  }, [jobCreationState]);

  const resetCreateForm = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateFileInputKey((current) => current + 1);
  };

  const resetEditForm = (job: JobRecord | null) => {
    if (!job) {
      setEditForm(EMPTY_EDIT_FORM);
      return;
    }
    setEditForm({
      title: job.title,
      description: job.description,
      affiliateLink: job.affiliateLink ?? ""
    });
  };

  const refreshJobs = useCallback(async (preferredJobId?: string) => {
    try {
      setJobsLoading(true);
      const list = await fetchJobs();
      const targetJobId = preferredJobId ?? selectedJobIdRef.current;
      const nextSelected = list.find((job) => job.jobId === targetJobId) ?? list[0] ?? null;
      setJobs(list);
      setSelectedJobId(nextSelected?.jobId ?? "");
      resetEditForm(nextSelected);
      if (!nextSelected) {
        setPanelMode(jobCreationStateRef.current?.phase === "uploading" ? "view" : "create");
      }
      setError("");
      return list;
    } catch (loadError) {
      setError((loadError as Error).message);
      return [];
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshJobs();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRetryClockMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (panelMode === "edit") {
      resetEditForm(selected);
    }
  }, [panelMode, selected?.jobId]);

  useEffect(() => {
    if (!jobCreationState) {
      return;
    }

    if (jobCreationState.phase === "uploading") {
      setPanelMode("view");
      setMessage("");
      setError("");
      return;
    }

    if (jobCreationState.phase === "created" && jobCreationState.jobId) {
      setPanelMode("view");
      setMessage(`Job ${jobCreationState.jobId} dibuat dengan status ${jobCreationState.status}.`);
      setError("");
      void refreshJobs(jobCreationState.jobId);
      onJobCreationStateHandled?.(jobCreationState.requestId);
      return;
    }

    if (jobCreationState.phase === "failed") {
      setError(jobCreationState.error ?? "Gagal membuat job.");
      setMessage("");
      setPanelMode((current) => (jobs.length ? current : "create"));
      onJobCreationStateHandled?.(jobCreationState.requestId);
    }
  }, [jobCreationState, jobs.length, onJobCreationStateHandled, refreshJobs]);

  const openCreatePanel = () => {
    resetCreateForm();
    setPanelMode("create");
    setError("");
    setMessage("");
  };

  const openEditPanel = () => {
    if (!selected || !isJobEditable(selected)) {
      return;
    }
    resetEditForm(selected);
    setPanelMode("edit");
    setError("");
    setMessage("");
  };

  const closePanel = () => {
    setPanelMode(selected ? "view" : "create");
    setError("");
  };

  const onRetry = async (platformId: PlatformId) => {
    if (!selected) {
      return;
    }
    try {
      setError("");
      setMessage("");
      await retryPlatform(selected.jobId, platformId);
      await refreshJobs(selected.jobId);
      setPanelMode("view");
      setMessage(`Platform ${PLATFORM_LABEL[platformId]} dimasukkan ulang ke antrean.`);
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

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (
      !createForm.video ||
      !createForm.title.trim() ||
      !createForm.description.trim() ||
      !createForm.affiliateLink.trim()
    ) {
      setError("Video, judul, deskripsi, dan affiliate link wajib diisi.");
      return;
    }

    try {
      setCreating(true);
      const result = await createJob({
        video: createForm.video,
        title: createForm.title.trim(),
        description: createForm.description.trim(),
        affiliateLink: createForm.affiliateLink.trim()
      });
      resetCreateForm();
      await refreshJobs(result.jobId);
      setPanelMode("view");
      setMessage(`Job ${result.jobId} dibuat dengan status ${result.status}.`);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) {
      return;
    }

    setMessage("");
    setError("");

    if (!editForm.title.trim() || !editForm.description.trim() || !editForm.affiliateLink.trim()) {
      setError("Judul, deskripsi, dan affiliate link wajib diisi.");
      return;
    }

    try {
      setSaving(true);
      const updated = await updateJob(selected.jobId, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        affiliateLink: editForm.affiliateLink.trim()
      });
      setJobs((current) => current.map((job) => (job.jobId === updated.jobId ? updated : job)));
      resetEditForm(updated);
      await refreshJobs(updated.jobId);
      setPanelMode("view");
      setMessage(
        updated.overallStatus === "queued"
          ? "Job diperbarui. Perubahan akan dipakai selama job belum mulai diproses."
          : "Job diperbarui. Klik Retry pada platform yang gagal untuk memproses ulang."
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!selected) {
      return;
    }
    if (!window.confirm(`Hapus job "${selected.title}"?`)) {
      return;
    }

    try {
      setDeleting(true);
      setMessage("");
      setError("");
      await deleteJob(selected.jobId);
      const remainingJobs = await refreshJobs("");
      setPanelMode(remainingJobs.length ? "view" : "create");
      setMessage(`Job ${selected.jobId} berhasil dihapus.`);
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const getOutputLinks = (
    platform: JobRecord["platforms"][number]
  ): Array<{ label: string; href: string }> => {
    const links: Array<{ label: string; href: string }> = [];
    if (platform.mp4Path) {
      links.push({ label: "MP4", href: toAbsoluteOutputUrl(platform.mp4Path) });
    }
    if (platform.captionPath) {
      links.push({
        label: "Caption TXT",
        href: toAbsoluteOutputUrl(platform.captionPath)
      });
    }
    return links;
  };

  const composeCaptionForCopy = (
    platform: JobRecord["platforms"][number],
    jobAffiliateLink?: string
  ): string => {
    const blocks = [
      platform.captionText ?? "",
      platform.hashtags?.join(" ") ?? "",
      jobAffiliateLink?.trim() ?? ""
    ].filter((value) => value.length > 0);
    return blocks.join("\n\n");
  };

  const canEditSelected = selected ? isJobEditable(selected) : false;
  const canDeleteSelected = selected ? isJobDeletable(selected) : false;

  return (
    <section className="page-shell jobs-page">
      <aside className="jobs-sidebar glass-panel">
        <div className="page-kicker">
          <i className="ti ti-layout-grid" />
          <span>Jobs</span>
        </div>
        <div className="jobs-sidebar__head">
          <div>
            <p className="eyebrow">Control Room</p>
            <h2>Jobs Dashboard</h2>
            <p className="section-note">
              Pantau antrean, output, dan retry tiap platform tanpa mengubah file hasil yang sudah
              ada.
            </p>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={openCreatePanel}>
              Job Baru
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void refreshJobs(selectedJobId)}
              disabled={jobsLoading}
            >
              {jobsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="jobs-stat-grid">
          <div className="meta-card">
            <strong>Total Jobs</strong>
            <div>{jobs.length}</div>
          </div>
          <div className="meta-card">
            <strong>Running</strong>
            <div>{jobs.filter((job) => job.overallStatus === "running").length}</div>
          </div>
        </div>

        <div className="job-list">
          {jobs.map((job) => (
            <button
              key={job.jobId}
              className={`job-item ${job.jobId === selected?.jobId ? "active" : ""}`}
              onClick={() => {
                setSelectedJobId(job.jobId);
                resetEditForm(job);
                setPanelMode("view");
              }}
            >
              <div className="job-item__row">
                <strong className="break-anywhere">{job.title}</strong>
                <StatusBadge status={job.overallStatus} />
              </div>
              <div className="small break-anywhere">#{job.jobId}</div>
              <div className="job-item__meta">
                <span>{job.platforms.length} platform</span>
                <span>{job.videoDurationSec.toFixed(1)} detik</span>
              </div>
            </button>
          ))}
          {!jobs.length && (
            <div className="empty-state">
              <i className="ti ti-clock-question" aria-hidden="true" />
              <p>Belum ada job. Klik `Job Baru` untuk membuat data pertama.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="jobs-main">
        <div className="job-toolbar glass-panel">
          <div>
            <p className="eyebrow">Workspace</p>
            <h3>
              {panelMode === "create"
                ? "Buat Job Baru"
                : panelMode === "edit"
                  ? "Edit Job"
                  : "Detail Job"}
            </h3>
            <p className="section-note">
              {panelMode === "create"
                ? "Satu job akan memproses semua platform sekaligus."
                : panelMode === "edit"
                  ? "Ubah metadata job yang dipilih."
                  : "Lihat detail, output, dan aksi retry untuk job terpilih."}
            </p>
          </div>
          <div className="form-actions">
            {panelMode !== "create" && (
              <button type="button" className="secondary-button" onClick={openCreatePanel}>
                Job Baru
              </button>
            )}
            {panelMode === "view" && selected && canEditSelected && (
              <button type="button" className="secondary-button" onClick={openEditPanel}>
                Edit Job
              </button>
            )}
            {panelMode === "view" && selected && (
              <button
                type="button"
                className="danger-button"
                onClick={() => void onDelete()}
                disabled={!canDeleteSelected || deleting}
              >
                {deleting ? "Menghapus..." : "Hapus Job"}
              </button>
            )}
            {panelMode !== "view" && (
              <button type="button" className="secondary-button" onClick={closePanel}>
                Tutup Panel
              </button>
            )}
          </div>
        </div>

        {jobCreationState?.phase === "uploading" && (
          <div className="progress-panel glass-panel">
            <div className="progress-head">
              <div>
                <strong>Mengirim Job Baru</strong>
                <p className="section-note">
                  Video untuk "{jobCreationState.title}" sedang diunggah dan disiapkan.
                </p>
              </div>
              <strong className="progress-label">Uploading...</strong>
            </div>
            <div
              className="job-progress-track"
              role="progressbar"
              aria-label={`Upload job ${jobCreationState.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext="Sedang mengunggah video"
            >
              <div className="job-progress-fill is-indeterminate" />
            </div>
          </div>
        )}

        {panelMode === "view" && selected && selectedProgress?.isAnimated && (
          <div className="progress-panel glass-panel">
            <div className="progress-head">
              <div>
                <strong>Progress Job Aktif</strong>
                <p className="section-note">{selectedProgress.summary}</p>
              </div>
              <strong className="progress-label">{selectedProgress.percent}%</strong>
            </div>
            <div
              className="job-progress-track"
              role="progressbar"
              aria-label={`Progress job ${selected.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={selectedProgress.percent}
            >
              <div
                className="job-progress-fill is-animated"
                style={{ width: `${selectedProgress.percent}%` }}
              />
            </div>
            <p className="progress-meta">{selectedProgress.detail}</p>
          </div>
        )}

        {panelMode === "create" && (
          <div className="section-card glass-panel">
            <form onSubmit={onCreate} className="grid-form">
              <label className="form-field">
                <span className="field-kicker">Video</span>
                <input
                  key={createFileInputKey}
                  type="file"
                  accept="video/*"
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      video: event.target.files?.[0] ?? null
                    }))
                  }
                  disabled={creating}
                />
              </label>
              <label className="form-field">
                <span className="field-kicker">Judul</span>
                <input
                  value={createForm.title}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      title: event.target.value
                    }))
                  }
                  disabled={creating}
                />
              </label>
              <label className="form-field">
                <span className="field-kicker">Deskripsi</span>
                <textarea
                  value={createForm.description}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  disabled={creating}
                />
              </label>
              <label className="form-field">
                <span className="field-kicker">Affiliate Link</span>
                <input
                  value={createForm.affiliateLink}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      affiliateLink: event.target.value
                    }))
                  }
                  disabled={creating}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={creating}>
                  {creating ? "Membuat..." : "Generate All Platforms"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => resetCreateForm()}
                  disabled={creating}
                >
                  Reset
                </button>
              </div>
            </form>
          </div>
        )}

        {panelMode === "edit" && selected && (
          <div className="section-card glass-panel">
            <div className="meta-grid">
              <div className="meta-card">
                <strong>Job ID</strong>
                <div className="break-anywhere">#{selected.jobId}</div>
              </div>
              <div className="meta-card">
                <strong>Status</strong>
                <div>
                  <StatusBadge status={selected.overallStatus} />
                </div>
              </div>
              <div className="meta-card">
                <strong>Platform</strong>
                <div>{selected.platforms.length} target</div>
              </div>
            </div>

            {!canEditSelected && (
              <p className="section-note">
                Job ini tidak bisa diedit karena statusnya bukan `queued`, `failed`, atau
                `interrupted`.
              </p>
            )}

            {canEditSelected && (
              <form onSubmit={onSave} className="grid-form">
                <label className="form-field">
                  <span className="field-kicker">Judul</span>
                  <input
                    value={editForm.title}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        title: event.target.value
                      }))
                    }
                    disabled={saving}
                  />
                </label>
                <label className="form-field">
                  <span className="field-kicker">Deskripsi</span>
                  <textarea
                    value={editForm.description}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    disabled={saving}
                  />
                </label>
                <label className="form-field">
                  <span className="field-kicker">Affiliate Link</span>
                  <input
                    value={editForm.affiliateLink}
                    onChange={(event) =>
                      setEditForm((current) => ({
                        ...current,
                        affiliateLink: event.target.value
                      }))
                    }
                    disabled={saving}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary-button" disabled={saving}>
                    {saving ? "Menyimpan..." : "Simpan Perubahan"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => resetEditForm(selected)}
                    disabled={saving}
                  >
                    Reset Form
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {panelMode === "view" && !selected && (
          <div className="section-card glass-panel">
            <div className="empty-state">
              <i className="ti ti-database-off" aria-hidden="true" />
              <p>Belum ada job aktif untuk ditampilkan.</p>
            </div>
          </div>
        )}

        {panelMode === "view" && selected && (
          <div className="detail-box glass-panel">
            <div className="meta-grid">
              <div className="meta-card">
                <strong>Judul</strong>
                <div className="break-anywhere">{selected.title}</div>
              </div>
              <div className="meta-card">
                <strong>Platform</strong>
                <div>{selected.platforms.length} target</div>
              </div>
              <div className="meta-card">
                <strong>Durasi</strong>
                <div>{selected.videoDurationSec.toFixed(2)} detik</div>
              </div>
              <div className="meta-card">
                <strong>Status</strong>
                <div>
                  <StatusBadge status={selected.overallStatus} />
                </div>
              </div>
            </div>

            <div className="detail-summary">
              <div className="detail-summary__copy">
                <strong>Affiliate Link</strong>
                {selected.affiliateLink ? (
                  <span className="break-anywhere">{selected.affiliateLink}</span>
                ) : (
                  <span className="small">Tidak tersedia</span>
                )}
              </div>
            </div>

            <div className="platform-run-list">
              {selected.platforms.map((platform) => {
                const outputLinks = getOutputLinks(platform);
                const retryCooldownMs = getRetryCooldownMs(platform.retryAfter, retryClockMs);
                const retryDisabled = retryCooldownMs > 0;
                return (
                  <article key={platform.platformId} className="platform-run-card">
                    <div className="platform-run-card__head">
                      <div>
                        <h4>{PLATFORM_LABEL[platform.platformId]}</h4>
                        <StatusBadge status={platform.status} />
                      </div>
                      {(platform.status === "failed" || platform.status === "interrupted") && (
                        <div className="platform-run-card__actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void onRetry(platform.platformId)}
                            disabled={retryDisabled}
                          >
                            {retryDisabled
                              ? `Retry (${formatRetryCooldown(retryCooldownMs)})`
                              : "Retry"}
                          </button>
                        </div>
                      )}
                    </div>

                    {platform.errorMessage && (
                      <div className="err-inline break-anywhere">{platform.errorMessage}</div>
                    )}

                    <div className="platform-run-card__body">
                      <div>
                        <p className="small">
                          {outputLinks.length
                            ? `Tersedia: ${outputLinks.map((item) => item.label).join(", ")}`
                            : "Belum ada file output"}
                        </p>
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
                      </div>

                      {(platform.captionText || platform.hashtags?.length) && (
                        <div className="caption-box">
                          {platform.captionText && (
                            <p className="break-anywhere">{platform.captionText}</p>
                          )}
                          {platform.hashtags?.length ? (
                            <p className="small break-anywhere">{platform.hashtags.join(" ")}</p>
                          ) : null}
                          {selected.affiliateLink && (
                            <p className="small break-anywhere">{selected.affiliateLink}</p>
                          )}
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              void copyToClipboard(
                                composeCaptionForCopy(platform, selected.affiliateLink)
                              )
                            }
                          >
                            Copy Caption
                          </button>
                        </div>
                      )}

                      {retryDisabled && (
                        <div className="small">Retry tersedia lagi sebentar lagi.</div>
                      )}
                    </div>
                  </article>
                );
              })}
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
