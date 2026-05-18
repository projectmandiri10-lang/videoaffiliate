import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { createJob, fetchSettings } from "../api";
import { PlatformSelector } from "../components/PlatformSelector";
import type { JobCreationTransition } from "../job-creation";
import { getEnabledPlatformIds, PLATFORM_ORDER, normalizePlatformIds } from "../platforms";
import type { PlatformId } from "../types";

interface GeneratePageProps {
  onSubmissionStateChange?: (transition: JobCreationTransition) => void;
}

export function GeneratePage({ onSubmissionStateChange }: GeneratePageProps) {
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [availablePlatformIds, setAvailablePlatformIds] = useState<PlatformId[]>(PLATFORM_ORDER);
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<PlatformId[]>(PLATFORM_ORDER);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const mountedRef = useRef(true);
  const platformSelectionTouchedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const loadPlatformDefaults = async () => {
      try {
        const settings = await fetchSettings();
        if (!mountedRef.current) {
          return;
        }
        const enabledPlatformIds = getEnabledPlatformIds(settings);
        setAvailablePlatformIds(enabledPlatformIds);
        if (!platformSelectionTouchedRef.current) {
          setSelectedPlatformIds(enabledPlatformIds);
        }
      } catch {
        // Keep frontend usable with default platform list when settings cannot be loaded.
      }
    };

    void loadPlatformDefaults();

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetForm = () => {
    setVideo(null);
    setTitle("");
    setDescription("");
    setAffiliateLink("");
    setFileInputKey((current) => current + 1);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!video || !title.trim() || !description.trim() || !affiliateLink.trim()) {
      setError("Video, judul, deskripsi, dan affiliate link wajib diisi.");
      return;
    }
    if (!selectedPlatformIds.length) {
      setError("Pilih minimal satu platform tujuan.");
      return;
    }

    setLoading(true);
    const requestId = Date.now();
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedAffiliateLink = affiliateLink.trim();

    onSubmissionStateChange?.({
      requestId,
      title: trimmedTitle,
      phase: "uploading"
    });

    try {
      const result = await createJob({
        video,
        title: trimmedTitle,
        description: trimmedDescription,
        affiliateLink: trimmedAffiliateLink,
        platformIds: selectedPlatformIds
      });
      if (mountedRef.current) {
        resetForm();
      }
      if (onSubmissionStateChange) {
        onSubmissionStateChange({
          requestId,
          title: trimmedTitle,
          phase: "created",
          jobId: result.jobId,
          status: result.status
        });
      } else if (mountedRef.current) {
        setMessage(`Job ${result.jobId} dibuat dengan status ${result.status}.`);
      }
    } catch (submitError) {
      const nextError = (submitError as Error).message;
      if (onSubmissionStateChange) {
        onSubmissionStateChange({
          requestId,
          title: trimmedTitle,
          phase: "failed",
          error: nextError
        });
      }
      if (mountedRef.current) {
        setError(nextError);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!loading) {
      setIsDragging(true);
    }
  };

  const onDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (loading) {
      return;
    }
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      setVideo(droppedFile);
    }
  };

  const onTogglePlatform = (platformId: PlatformId) => {
    if (loading || !availablePlatformIds.includes(platformId)) {
      return;
    }
    platformSelectionTouchedRef.current = true;
    setSelectedPlatformIds((current) =>
      normalizePlatformIds(
        current.includes(platformId)
          ? current.filter((item) => item !== platformId)
          : [...current, platformId]
      )
    );
  };

  return (
    <section className="page-shell generate-page glass-panel">
      <div className="generate-page__hero">
        <div className="page-kicker">
          <i className="ti ti-cpu-2" />
          <span>Generate</span>
        </div>
        <div className="generate-page__hero-copy">
          <p className="eyebrow">Neural Launchpad</p>
          <h2>
            Siapkan satu video master untuk semua channel affiliate Anda.
          </h2>
          <p className="page-intro">
            Upload video, pilih platform yang dibutuhkan, lalu sistem hanya akan memproses
            channel yang Anda aktifkan.
          </p>
        </div>
        <div className="hero-badge-grid">
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Pipeline</span>
            <strong>
              {selectedPlatformIds.length > 0
                ? `${selectedPlatformIds.length} Platform`
                : "Pilih Platform"}
            </strong>
          </div>
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Status</span>
            <strong>{selectedPlatformIds.length > 0 ? "Ready to render" : "Butuh pilihan"}</strong>
          </div>
        </div>
        <div className="hero-pills">
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--cyan" />
            Upload aman
          </div>
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--violet" />
            Output tetap tersimpan
          </div>
        </div>
      </div>

      <div className="generate-page__form">
        <form onSubmit={onSubmit} className="grid-form">
          <label
            className={`upload-field ${isDragging ? "is-dragging" : ""} ${
              video ? "has-file" : ""
            }`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <span className="field-kicker">Video</span>
            <input
              key={fileInputKey}
              id="video-input"
              className="sr-only"
              aria-label="Video"
              type="file"
              accept="video/*"
              onChange={(event) => setVideo(event.target.files?.[0] || null)}
              disabled={loading}
            />
            <span className="upload-field__surface">
              <span className="upload-field__icon" aria-hidden="true">
                <i className="ti ti-movie" />
              </span>
              <span className="upload-field__copy">
                <strong>{video ? video.name : "Drag & drop video Anda di sini"}</strong>
                <span>
                  {video
                    ? "File siap diproses. Klik area ini untuk mengganti file."
                    : "Klik untuk memilih file lokal atau jatuhkan MP4/MOV di area ini."}
                </span>
              </span>
            </span>
          </label>

          <label className="form-field">
            <span className="field-kicker">Judul</span>
            <input
              aria-label="Judul"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={loading}
              placeholder="Contoh: Promo skincare harian"
            />
          </label>

          <label className="form-field">
            <span className="field-kicker">Deskripsi</span>
            <textarea
              aria-label="Deskripsi"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading}
              placeholder="Jelaskan konten video agar AI bisa membentuk script dan caption."
            />
          </label>

          <label className="form-field">
            <span className="field-kicker">Affiliate Link</span>
            <input
              aria-label="Affiliate Link"
              value={affiliateLink}
              placeholder="https://..."
              onChange={(event) => setAffiliateLink(event.target.value)}
              disabled={loading}
            />
          </label>

          <PlatformSelector
            selectedPlatformIds={selectedPlatformIds}
            availablePlatformIds={availablePlatformIds}
            disabled={loading}
            onTogglePlatform={onTogglePlatform}
          />

          <button type="submit" className="primary-button" disabled={loading}>
            <i className="ti ti-bolt" aria-hidden="true" />
            <span>{loading ? "Memproses..." : "Generate Platform Terpilih"}</span>
          </button>
        </form>

        {message && <p className="ok-text">{message}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
