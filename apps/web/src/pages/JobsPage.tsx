import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createJob,
  deleteJob,
  fetchSettings,
  fetchJobs,
  replaceJobSource,
  retryPlatformCaption,
  retryPlatformJob,
  toAbsoluteOutputUrl,
  updateJob,
  updatePlatformMetadata
} from "../api";
import { PlatformSelector } from "../components/PlatformSelector";
import type { JobCreationTransition } from "../job-creation";
import { getEnabledPlatformIds, PLATFORM_LABEL, PLATFORM_ORDER, normalizePlatformIds } from "../platforms";
import { StatusBadge } from "../components/StatusBadge";
import type { JobRecord, PlatformId } from "../types";

const DEFAULT_RENDER_LABEL: Record<PlatformId, string> = {
  tiktok: "Native Source",
  youtube: "YouTube Editorial",
  facebook: "Facebook Story",
  shopee: "Shopee Sales"
};

const RENDER_PROFILE_LABEL: Record<string, string> = {
  native_source: "Native Source",
  youtube_editorial: "YouTube Editorial",
  facebook_story: "Facebook Story",
  shopee_sales: "Shopee Sales"
};

type PanelMode = "view" | "create" | "edit" | "source";

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

interface PlatformEditFormState {
  title: string;
  description: string;
  affiliateLink: string;
  captionText: string;
  hashtagsText: string;
}

interface SourceFormState {
  video: File | null;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  video: null,
  title: "",
  description: "",
  affiliateLink: ""
};

const EMPTY_PLATFORM_EDIT_FORM: PlatformEditFormState = {
  title: "",
  description: "",
  affiliateLink: "",
  captionText: "",
  hashtagsText: ""
};

const EMPTY_EDIT_FORM: EditFormState = {
  title: "",
  description: "",
  affiliateLink: ""
};

const EMPTY_SOURCE_FORM: SourceFormState = {
  video: null
};

function isJobEditable(job: JobRecord): boolean {
  return ["queued", "failed", "interrupted"].includes(job.overallStatus);
}

function isJobDeletable(job: JobRecord): boolean {
  return job.overallStatus !== "running";
}

function isJobSourceReplaceable(job: JobRecord): boolean {
  return !["queued", "running"].includes(job.overallStatus);
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

function getEffectivePlatformMetadata(
  job: JobRecord,
  platform: JobRecord["platforms"][number]
): {
  title: string;
  description: string;
  affiliateLink: string;
} {
  return {
    title: platform.titleOverride?.trim() || job.title,
    description: platform.descriptionOverride?.trim() || job.description,
    affiliateLink: platform.affiliateLinkOverride?.trim() || job.affiliateLink || ""
  };
}

function parseHashtagsInput(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRenderProfileLabel(platform: JobRecord["platforms"][number]): string {
  if (platform.renderProfileId && RENDER_PROFILE_LABEL[platform.renderProfileId]) {
    return RENDER_PROFILE_LABEL[platform.renderProfileId] ?? DEFAULT_RENDER_LABEL[platform.platformId];
  }
  return DEFAULT_RENDER_LABEL[platform.platformId];
}

function getVisualAuditLabel(platform: JobRecord["platforms"][number]): string | undefined {
  if (!platform.visualAuditStatus) {
    return undefined;
  }
  if (platform.visualAuditStatus === "skipped") {
    return platform.platformId === "tiktok" ? "Audit: reference native" : "Audit: skipped";
  }

  const score =
    typeof platform.visualAuditScore === "number"
      ? ` (${platform.visualAuditScore.toFixed(2)})`
      : "";
  const boosted = platform.visualAuditBoosted ? " boosted" : "";
  return `Audit: ${platform.visualAuditStatus}${boosted}${score}`;
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

function formatElapsedRenderTime(elapsedMs: number): string {
  const totalSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} detik`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} menit` : `${minutes} menit ${seconds} detik`;
}

function getPlatformRenderProgress(
  platform: JobRecord["platforms"][number],
  nowMs = Date.now()
): {
  percent: number;
  detail: string;
} | null {
  if (platform.status !== "running") {
    return null;
  }

  const startedAtMs = Date.parse(platform.updatedAt);
  const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : 0;
  const minPercent = 12;
  const maxPercent = 94;
  const progressRatio = 1 - Math.exp(-elapsedMs / 45_000);
  const percent = Math.round(minPercent + (maxPercent - minPercent) * progressRatio);

  return {
    percent: Math.max(minPercent, Math.min(percent, maxPercent)),
    detail:
      elapsedMs < 1_500
        ? "Render baru dimulai."
        : `Render berjalan sekitar ${formatElapsedRenderTime(elapsedMs)}.`
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
  const [replacingSource, setReplacingSource] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copyInfo, setCopyInfo] = useState("");
  const [createFileInputKey, setCreateFileInputKey] = useState(0);
  const [sourceFileInputKey, setSourceFileInputKey] = useState(0);
  const [retryClockMs, setRetryClockMs] = useState(() => Date.now());
  const [editingPlatformId, setEditingPlatformId] = useState<PlatformId | "">("");
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformActionKey, setPlatformActionKey] = useState("");
  const [availablePlatformIds, setAvailablePlatformIds] = useState<PlatformId[]>(PLATFORM_ORDER);
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<PlatformId[]>(PLATFORM_ORDER);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE_FORM);
  const [editForm, setEditForm] = useState<EditFormState>(EMPTY_EDIT_FORM);
  const [sourceForm, setSourceForm] = useState<SourceFormState>(EMPTY_SOURCE_FORM);
  const [platformEditForm, setPlatformEditForm] =
    useState<PlatformEditFormState>(EMPTY_PLATFORM_EDIT_FORM);
  const selectedJobIdRef = useRef("");
  const jobCreationStateRef = useRef<JobCreationTransition | null>(jobCreationState);
  const createPlatformSelectionTouchedRef = useRef(false);

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

  useEffect(() => {
    let active = true;

    const loadPlatformDefaults = async () => {
      try {
        const settings = await fetchSettings();
        if (!active) {
          return;
        }
        const enabledPlatformIds = getEnabledPlatformIds(settings);
        setAvailablePlatformIds(enabledPlatformIds);
        if (!createPlatformSelectionTouchedRef.current) {
          setSelectedPlatformIds(enabledPlatformIds);
        }
      } catch {
        // Keep local defaults when settings cannot be loaded.
      }
    };

    void loadPlatformDefaults();

    return () => {
      active = false;
    };
  }, []);

  const resetCreateForm = () => {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateFileInputKey((current) => current + 1);
  };

  const resetSourceForm = () => {
    setSourceForm(EMPTY_SOURCE_FORM);
    setSourceFileInputKey((current) => current + 1);
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

  const openPlatformEdit = (job: JobRecord, platform: JobRecord["platforms"][number]) => {
    const metadata = getEffectivePlatformMetadata(job, platform);
    setEditingPlatformId(platform.platformId);
    setPlatformEditForm({
      title: metadata.title,
      description: metadata.description,
      affiliateLink: metadata.affiliateLink,
      captionText: platform.captionText ?? "",
      hashtagsText: platform.hashtags?.join(" ") ?? ""
    });
    setError("");
    setMessage("");
  };

  const closePlatformEdit = () => {
    setEditingPlatformId("");
    setPlatformEditForm(EMPTY_PLATFORM_EDIT_FORM);
    setError("");
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
    if (panelMode === "source") {
      resetSourceForm();
    }
  }, [panelMode, selected?.jobId]);

  useEffect(() => {
    setEditingPlatformId("");
    setPlatformEditForm(EMPTY_PLATFORM_EDIT_FORM);
    resetSourceForm();
  }, [selected?.jobId]);

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

  const openSourcePanel = () => {
    if (!selected || !isJobSourceReplaceable(selected)) {
      return;
    }
    resetSourceForm();
    setPanelMode("source");
    setError("");
    setMessage("");
  };

  const closePanel = () => {
    setPanelMode(selected ? "view" : "create");
    setError("");
  };

  const onRetryJob = async (platformId: PlatformId) => {
    if (!selected) {
      return;
    }
    try {
      setError("");
      setMessage("");
      setPlatformActionKey(`${platformId}:job`);
      await retryPlatformJob(selected.jobId, platformId);
      await refreshJobs(selected.jobId);
      setPanelMode("view");
      setMessage(`Retry Job ${PLATFORM_LABEL[platformId]} dimasukkan ke antrean.`);
    } catch (retryError) {
      setError((retryError as Error).message);
    } finally {
      setPlatformActionKey("");
    }
  };

  const onRetryCaption = async (platformId: PlatformId) => {
    if (!selected) {
      return;
    }
    try {
      setError("");
      setMessage("");
      setPlatformActionKey(`${platformId}:caption`);
      const updated = await retryPlatformCaption(selected.jobId, platformId);
      setJobs((current) => current.map((job) => (job.jobId === updated.jobId ? updated : job)));
      await refreshJobs(updated.jobId);
      setPanelMode("view");
      setMessage(`Caption ${PLATFORM_LABEL[platformId]} berhasil dibuat ulang.`);
    } catch (retryError) {
      setError((retryError as Error).message);
    } finally {
      setPlatformActionKey("");
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

  const onToggleCreatePlatform = (platformId: PlatformId) => {
    if (creating || !availablePlatformIds.includes(platformId)) {
      return;
    }
    createPlatformSelectionTouchedRef.current = true;
    setSelectedPlatformIds((current) =>
      normalizePlatformIds(
        current.includes(platformId)
          ? current.filter((item) => item !== platformId)
          : [...current, platformId]
      )
    );
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
    if (!selectedPlatformIds.length) {
      setError("Pilih minimal satu platform tujuan.");
      return;
    }

    try {
      setCreating(true);
      const result = await createJob({
        video: createForm.video,
        title: createForm.title.trim(),
        description: createForm.description.trim(),
        affiliateLink: createForm.affiliateLink.trim(),
        platformIds: selectedPlatformIds
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

  const onReplaceSource = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) {
      return;
    }

    setMessage("");
    setError("");

    if (!sourceForm.video) {
      setError("Video source baru wajib dipilih.");
      return;
    }

    try {
      setReplacingSource(true);
      const updated = await replaceJobSource(selected.jobId, sourceForm.video);
      setJobs((current) => current.map((job) => (job.jobId === updated.jobId ? updated : job)));
      resetSourceForm();
      await refreshJobs(updated.jobId);
      setPanelMode("view");
      setMessage(
        "Source utama berhasil diganti. Output lama dibersihkan, lalu gunakan Retry Job per platform untuk render ulang."
      );
    } catch (replaceError) {
      setError((replaceError as Error).message);
    } finally {
      setReplacingSource(false);
    }
  };

  const onSavePlatformMetadata = async (
    event: FormEvent,
    platformId: PlatformId
  ) => {
    event.preventDefault();
    if (!selected) {
      return;
    }

    setMessage("");
    setError("");

    if (
      !platformEditForm.title.trim() ||
      !platformEditForm.description.trim() ||
      !platformEditForm.affiliateLink.trim() ||
      !platformEditForm.captionText.trim()
    ) {
      setError("Judul, deskripsi, affiliate link, dan caption platform wajib diisi.");
      return;
    }

    try {
      setSavingPlatform(true);
      const updated = await updatePlatformMetadata(selected.jobId, platformId, {
        title: platformEditForm.title.trim(),
        description: platformEditForm.description.trim(),
        affiliateLink: platformEditForm.affiliateLink.trim(),
        captionText: platformEditForm.captionText.trim(),
        hashtags: parseHashtagsInput(platformEditForm.hashtagsText)
      });
      setJobs((current) => current.map((job) => (job.jobId === updated.jobId ? updated : job)));
      await refreshJobs(updated.jobId);
      setEditingPlatformId("");
      setPlatformEditForm(EMPTY_PLATFORM_EDIT_FORM);
      setMessage(`Metadata ${PLATFORM_LABEL[platformId]} berhasil disimpan.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSavingPlatform(false);
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
  const canReplaceSourceSelected = selected ? isJobSourceReplaceable(selected) : false;
  const selectedSourceFilename = selected ? selected.videoPath.split(/[\\/]/).pop() || "-" : "-";

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
              Pantau antrean, output, retry, metadata, dan source utama video per job.
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
                  : panelMode === "source"
                    ? "Ganti Source Job"
                  : "Detail Job"}
            </h3>
            <p className="section-note">
              {panelMode === "create"
                ? "Satu job hanya akan memproses platform yang Anda pilih."
                : panelMode === "edit"
                  ? "Ubah metadata job yang dipilih."
                  : panelMode === "source"
                    ? "Ganti source utama untuk semua platform lalu render ulang manual per platform."
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
            {panelMode === "view" && selected && canReplaceSourceSelected && (
              <button type="button" className="secondary-button" onClick={openSourcePanel}>
                Ganti Source
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
              <PlatformSelector
                selectedPlatformIds={selectedPlatformIds}
                availablePlatformIds={availablePlatformIds}
                disabled={creating}
                onTogglePlatform={onToggleCreatePlatform}
              />
              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={creating}>
                  {creating ? "Membuat..." : "Generate Platform Terpilih"}
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

        {panelMode === "source" && selected && (
          <div className="section-card glass-panel">
            <div className="meta-grid">
              <div className="meta-card">
                <strong>Job ID</strong>
                <div className="break-anywhere">#{selected.jobId}</div>
              </div>
              <div className="meta-card">
                <strong>Source Saat Ini</strong>
                <div className="break-anywhere">{selectedSourceFilename}</div>
              </div>
              <div className="meta-card">
                <strong>Durasi Saat Ini</strong>
                <div>{selected.videoDurationSec.toFixed(2)} detik</div>
              </div>
            </div>

            {!canReplaceSourceSelected && (
              <p className="section-note">
                Source video tidak bisa diganti saat job masih queued atau running.
              </p>
            )}

            {canReplaceSourceSelected && (
              <form onSubmit={onReplaceSource} className="grid-form">
                <p className="section-note">
                  Mengganti source utama akan membersihkan output lama untuk TikTok, YouTube,
                  Facebook, dan Shopee. Setelah disimpan, gunakan `Retry Job` pada tiap platform
                  untuk membuat hasil baru.
                </p>
                <label className="form-field">
                  <span className="field-kicker">Video Source Baru</span>
                  <input
                    key={sourceFileInputKey}
                    type="file"
                    accept="video/*"
                    onChange={(event) =>
                      setSourceForm({
                        video: event.target.files?.[0] ?? null
                      })
                    }
                    disabled={replacingSource}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary-button" disabled={replacingSource}>
                    {replacingSource ? "Mengganti..." : "Simpan Source Baru"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={closePanel}
                    disabled={replacingSource}
                  >
                    Batal
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
                const metadata = getEffectivePlatformMetadata(selected, platform);
                const platformProgress = getPlatformRenderProgress(platform, retryClockMs);
                const platformBusy =
                  selected.overallStatus === "running" || platform.status === "running";
                const retryJobDisabled =
                  platformBusy || retryDisabled || platform.status === "pending";
                const retryCaptionDisabled = platformBusy || !platform.scriptText?.trim();
                const isEditingPlatform = editingPlatformId === platform.platformId;
                return (
                  <article key={platform.platformId} className="platform-run-card">
                    <div className="platform-run-card__head">
                      <div>
                        <h4>{PLATFORM_LABEL[platform.platformId]}</h4>
                        <div className="small">Render: {getRenderProfileLabel(platform)}</div>
                        {getVisualAuditLabel(platform) && (
                          <div className="small">{getVisualAuditLabel(platform)}</div>
                        )}
                        <StatusBadge status={platform.status} />
                      </div>
                      <div className="platform-run-card__actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void onRetryCaption(platform.platformId)}
                          disabled={
                            retryCaptionDisabled ||
                            platformActionKey === `${platform.platformId}:caption`
                          }
                        >
                          {platformActionKey === `${platform.platformId}:caption`
                            ? "Retrying..."
                            : "Retry Caption"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => void onRetryJob(platform.platformId)}
                          disabled={
                            retryJobDisabled || platformActionKey === `${platform.platformId}:job`
                          }
                        >
                          {platformActionKey === `${platform.platformId}:job`
                            ? "Queuing..."
                            : retryDisabled
                              ? `Retry Job (${formatRetryCooldown(retryCooldownMs)})`
                              : "Retry Job"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => openPlatformEdit(selected, platform)}
                          disabled={platformBusy}
                        >
                          Edit
                        </button>
                      </div>
                    </div>

                    {platform.errorMessage && (
                      <div className="err-inline break-anywhere">{platform.errorMessage}</div>
                    )}

                    <div className="platform-run-card__body">
                      {platformProgress && (
                        <div className="platform-progress">
                          <div className="platform-progress__meta">
                            <strong>Progress Render</strong>
                            <span className="platform-progress__percent">
                              {platformProgress.percent}%
                            </span>
                          </div>
                          <div
                            className="job-progress-track platform-progress__track"
                            role="progressbar"
                            aria-label={`Progress render ${PLATFORM_LABEL[platform.platformId]}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={platformProgress.percent}
                          >
                            <div
                              className="job-progress-fill is-animated"
                              style={{ width: `${platformProgress.percent}%` }}
                            />
                          </div>
                          <p className="platform-progress__detail">{platformProgress.detail}</p>
                        </div>
                      )}

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

                      <div className="caption-box">
                        {platform.captionText ? (
                          <p className="break-anywhere">{platform.captionText}</p>
                        ) : (
                          <p className="small">Belum ada caption untuk platform ini.</p>
                        )}
                        {platform.hashtags?.length ? (
                          <p className="small break-anywhere">{platform.hashtags.join(" ")}</p>
                        ) : null}
                        {metadata.affiliateLink && (
                          <p className="small break-anywhere">{metadata.affiliateLink}</p>
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            void copyToClipboard(
                              composeCaptionForCopy(platform, metadata.affiliateLink)
                            )
                          }
                          disabled={!platform.captionText && !platform.hashtags?.length}
                        >
                          Copy Caption
                        </button>
                      </div>

                      {isEditingPlatform && (
                        <form
                          className="platform-edit-form"
                          onSubmit={(event) =>
                            void onSavePlatformMetadata(event, platform.platformId)
                          }
                        >
                          <label className="form-field">
                            <span className="field-kicker">Judul Platform</span>
                            <input
                              value={platformEditForm.title}
                              onChange={(event) =>
                                setPlatformEditForm((current) => ({
                                  ...current,
                                  title: event.target.value
                                }))
                              }
                              disabled={savingPlatform}
                            />
                          </label>
                          <label className="form-field">
                            <span className="field-kicker">Deskripsi Platform</span>
                            <textarea
                              value={platformEditForm.description}
                              onChange={(event) =>
                                setPlatformEditForm((current) => ({
                                  ...current,
                                  description: event.target.value
                                }))
                              }
                              disabled={savingPlatform}
                            />
                          </label>
                          <label className="form-field">
                            <span className="field-kicker">Affiliate Link Platform</span>
                            <input
                              value={platformEditForm.affiliateLink}
                              onChange={(event) =>
                                setPlatformEditForm((current) => ({
                                  ...current,
                                  affiliateLink: event.target.value
                                }))
                              }
                              disabled={savingPlatform}
                            />
                          </label>
                          <label className="form-field">
                            <span className="field-kicker">Caption</span>
                            <textarea
                              value={platformEditForm.captionText}
                              onChange={(event) =>
                                setPlatformEditForm((current) => ({
                                  ...current,
                                  captionText: event.target.value
                                }))
                              }
                              disabled={savingPlatform}
                            />
                          </label>
                          <label className="form-field">
                            <span className="field-kicker">Hashtags</span>
                            <input
                              value={platformEditForm.hashtagsText}
                              onChange={(event) =>
                                setPlatformEditForm((current) => ({
                                  ...current,
                                  hashtagsText: event.target.value
                                }))
                              }
                              placeholder="#planterbag #affiliate"
                              disabled={savingPlatform}
                            />
                          </label>
                          <div className="form-actions">
                            <button
                              type="submit"
                              className="primary-button"
                              disabled={savingPlatform}
                            >
                              {savingPlatform ? "Menyimpan..." : "Simpan Platform"}
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={closePlatformEdit}
                              disabled={savingPlatform}
                            >
                              Batal
                            </button>
                          </div>
                        </form>
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
