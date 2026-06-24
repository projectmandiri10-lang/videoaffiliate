import { useState, type DragEvent, type FormEvent } from "react";
import { createJob } from "../api";
import type { JobCreationTransition } from "../job-creation";

interface GeneratePageProps {
  onSubmissionStateChange?: (transition: JobCreationTransition) => void;
}

export function GeneratePage({ onSubmissionStateChange }: GeneratePageProps) {
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

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
        affiliateLink: trimmedAffiliateLink
      });
      resetForm();
      onSubmissionStateChange?.({
        requestId,
        title: trimmedTitle,
        phase: "created",
        jobId: result.jobId,
        status: result.status
      });
      setMessage(`Job ${result.jobId} masuk antrean analisis.`);
    } catch (submitError) {
      const nextError = (submitError as Error).message;
      onSubmissionStateChange?.({
        requestId,
        title: trimmedTitle,
        phase: "failed",
        error: nextError
      });
      setError(nextError);
    } finally {
      setLoading(false);
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

  return (
    <section className="page-shell generate-page glass-panel">
      <div className="generate-page__hero">
        <div className="page-kicker">
          <i className="ti ti-scissors" />
          <span>Analyze</span>
        </div>
        <div className="generate-page__hero-copy">
          <p className="eyebrow">YouTube Shorts Clippers</p>
          <h2>Upload satu video produk maksimal 30 detik, lalu browser pilih 3 momen terbaik.</h2>
          <p className="page-intro">
            Workflow ini khusus untuk YouTube Shorts affiliate: source maksimal 30 detik, Gemini menganalisa 6 frame penting, lalu voice over dan CTA dibuat lebih tajam untuk hook dan klik link.
          </p>
        </div>
        <div className="hero-badge-grid">
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Output</span>
            <strong>3 kandidat clip</strong>
          </div>
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Durasi</span>
            <strong>18-30 detik</strong>
          </div>
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Gemini</span>
            <strong>6 frame analisis</strong>
          </div>
        </div>
        <div className="hero-pills">
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--cyan" />
            Audio source dimute
          </div>
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--violet" />
            Tab harus tetap terbuka
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
            <span className="field-kicker">Video Produk</span>
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
                <strong>{video ? video.name : "Drag & drop video produk Anda di sini"}</strong>
                <span>
                  {video
                    ? "File siap dianalisis. Klik area ini untuk mengganti file."
                    : "Upload MP4/MOV lokal maksimal 30 detik. Video tetap diproses di perangkat Anda."}
                </span>
              </span>
            </span>
          </label>

          <label className="form-field">
            <span className="field-kicker">Judul Produk</span>
            <input
              aria-label="Judul"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={loading}
              placeholder="Contoh: Blender portable mini"
            />
          </label>

          <label className="form-field">
            <span className="field-kicker">Deskripsi Produk</span>
            <textarea
              aria-label="Deskripsi"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading}
              placeholder="Jelaskan fitur, manfaat, dan konteks isi video agar AI lebih akurat."
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

          <button type="submit" className="primary-button" disabled={loading}>
            <i className="ti ti-bolt" aria-hidden="true" />
            <span>{loading ? "Menganalisis..." : "Analisis Video & Buat Kandidat Clip"}</span>
          </button>
        </form>

        {message && <p className="ok-text">{message}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
