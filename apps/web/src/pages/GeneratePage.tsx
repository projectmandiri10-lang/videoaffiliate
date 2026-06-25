import {
  DEFAULT_YOUTUBE_TTS_GENDER,
  FEATURED_YOUTUBE_TTS_OPTIONS,
  findTtsVoiceByName,
  getFeaturedYoutubeTtsOption
} from "@app/core";
import { useState, type DragEvent, type FormEvent } from "react";
import { createJob, updateSettings } from "../api";
import type { JobCreationTransition } from "../job-creation";
import { usePipelineState } from "../lib/use-pipeline-state";

const HOMEPAGE_GUIDES = [
  {
    label: "Langkah 1",
    title: "Upload video produk",
    description:
      "Masukkan satu video singkat produk. Cocok untuk konten affiliate yang ingin dibuat lebih cepat."
  },
  {
    label: "Langkah 2",
    title: "Pilih potongan terbaik",
    description:
      "Sistem menyiapkan beberapa pilihan potongan video agar Anda tinggal pilih yang paling menarik."
  },
  {
    label: "Langkah 3",
    title: "Download hasil jadi",
    description:
      "Setelah selesai, hasil video, subtitle, dan caption bisa langsung diunduh dari browser."
  }
] as const;

interface GeneratePageProps {
  onSubmissionStateChange?: (transition: JobCreationTransition) => void;
}

export function GeneratePage({ onSubmissionStateChange }: GeneratePageProps) {
  const { settings } = usePipelineState();
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceLoading, setVoiceLoading] = useState<"female" | "male" | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const youtubePlatform = settings.platforms.find((platform) => platform.platformId === "youtube");
  const activeVoiceName =
    youtubePlatform?.voiceName ||
    getFeaturedYoutubeTtsOption(DEFAULT_YOUTUBE_TTS_GENDER).voiceName;
  const activeVoice = findTtsVoiceByName(activeVoiceName);

  const resetForm = () => {
    setVideo(null);
    setTitle("");
    setDescription("");
    setAffiliateLink("");
    setFileInputKey((current) => current + 1);
  };

  const handleVoiceChoice = async (gender: "female" | "male") => {
    const featuredVoice = getFeaturedYoutubeTtsOption(gender);
    if (!youtubePlatform || youtubePlatform.voiceName === featuredVoice.voiceName) {
      return;
    }
    setVoiceError("");
    setVoiceLoading(gender);
    try {
      await updateSettings({
        ...settings,
        platforms: settings.platforms.map((platform) =>
          platform.platformId === "youtube"
            ? { ...platform, voiceName: featuredVoice.voiceName }
            : platform
        )
      });
    } catch (voiceUpdateError) {
      setVoiceError((voiceUpdateError as Error).message);
    } finally {
      setVoiceLoading(null);
    }
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
          <p className="eyebrow">Simple Workflow</p>
          <h2>Upload video, pilih hasil terbaik, lalu unduh videonya.</h2>
          <p className="page-intro">
            Tampilan ini dibuat sederhana agar mudah dipakai. Anda cukup menyiapkan video
            produk, isi informasi singkat, lalu tunggu hasil suara dan subtitle selesai dibuat.
          </p>
        </div>
        <div className="hero-badge-grid">
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Video</span>
            <strong>1 video per proses</strong>
          </div>
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Durasi</span>
            <strong>Maksimal 30 detik</strong>
          </div>
          <div className="hero-badge-card">
            <span className="hero-badge-card__label">Hasil</span>
            <strong>Video + subtitle + caption</strong>
          </div>
        </div>
        <div className="hero-pills">
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--cyan" />
            Cocok untuk affiliate video pendek
          </div>
          <div className="footer-pill">
            <span className="footer-pill__dot footer-pill__dot--violet" />
            Tab harus tetap terbuka
          </div>
        </div>
        <div className="generate-page__explainer" aria-label="Penjelasan utama aplikasi">
          {HOMEPAGE_GUIDES.map((guide) => (
            <article key={guide.title} className="generate-guide-card">
              <span className="generate-guide-card__label">{guide.label}</span>
              <h3>{guide.title}</h3>
              <p>{guide.description}</p>
            </article>
          ))}
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
                    : "Upload MP4 atau MOV maksimal 30 detik."}
                </span>
              </span>
            </span>
          </label>

          <div className="voice-choice-panel" aria-label="Pilihan suara narator">
            <div className="voice-choice-panel__head">
              <span className="field-kicker">Suara Narator</span>
              <p className="small">
                Pilih suara Google TTS yang paling natural untuk narasi Bahasa Indonesia.
              </p>
            </div>

            <div className="voice-choice-grid">
              {FEATURED_YOUTUBE_TTS_OPTIONS.map((option) => {
                const isSelected = activeVoiceName === option.voiceName;
                return (
                  <button
                    key={option.voiceName}
                    type="button"
                    className={`voice-choice-card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => void handleVoiceChoice(option.gender)}
                    disabled={loading || voiceLoading !== null}
                    aria-pressed={isSelected}
                  >
                    <span className="voice-choice-card__kicker">{option.title}</span>
                    <strong>{option.voiceName}</strong>
                    <span className="voice-choice-card__tone">{option.tone}</span>
                    <span className="voice-choice-card__description">{option.description}</span>
                    <span className="voice-choice-card__status">
                      {voiceLoading === option.gender
                        ? "Menyimpan pilihan..."
                        : isSelected
                          ? "Sedang dipakai"
                          : "Pilih suara ini"}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="small">
              Aktif sekarang: <strong>{activeVoiceName}</strong>
              {activeVoice ? ` · ${activeVoice.tone}` : ""}. Pilihan ini disimpan di browser ini.
            </p>
            {voiceError && <p className="err-text">{voiceError}</p>}
          </div>

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
              placeholder="Tulis poin penting produk secara singkat."
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
            <span>{loading ? "Memproses..." : "Buat Hasil Video"}</span>
          </button>
        </form>

        {message && <p className="ok-text">{message}</p>}
        {error && <p className="err-text">{error}</p>}
      </div>
    </section>
  );
}
