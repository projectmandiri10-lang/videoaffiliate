import { useState, type FormEvent } from "react";
import { createJob } from "../api";

export function GeneratePage() {
  const [video, setVideo] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [affiliateLink, setAffiliateLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

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
    try {
      const result = await createJob({
        video,
        title: title.trim(),
        description: description.trim(),
        affiliateLink: affiliateLink.trim()
      });
      setMessage(`Job ${result.jobId} dibuat dengan status ${result.status}.`);
      resetForm();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card">
      <h2>Generate</h2>
      <p>Upload satu video untuk memproses TikTok, YouTube Shorts, Facebook, dan Shopee sekaligus.</p>
      <form onSubmit={onSubmit} className="grid-form">
        <label>
          Video
          <input
            key={fileInputKey}
            id="video-input"
            type="file"
            accept="video/*"
            onChange={(event) => setVideo(event.target.files?.[0] || null)}
            disabled={loading}
          />
        </label>
        <label>
          Judul
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Deskripsi
          <textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading}
          />
        </label>
        <label>
          Affiliate Link
          <input
            value={affiliateLink}
            placeholder="https://..."
            onChange={(event) => setAffiliateLink(event.target.value)}
            disabled={loading}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Memproses..." : "Generate All Platforms"}
        </button>
      </form>
      {message && <p className="ok-text">{message}</p>}
      {error && <p className="err-text">{error}</p>}
    </section>
  );
}
