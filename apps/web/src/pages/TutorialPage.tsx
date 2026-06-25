const TUTORIAL_STEPS = [
  {
    title: "Upload video produk",
    description:
      "Masukkan 1 video lokal maksimal 30 detik. Untuk workflow ini, format pendek lebih stabil di browser dan lebih pas untuk YouTube Shorts affiliate."
  },
  {
    title: "Isi brief affiliate",
    description:
      "Lengkapi judul, deskripsi, dan affiliate link. Sistem akan membangun hook, CTA, caption, dan arah voice over dari brief ini."
  },

  {
    title: "Pilih clip terbaik",
    description:
      "Bandingkan alasan skor tiap kandidat, lalu pilih clip dengan hook paling cepat, visual paling jelas, dan potensi CTA terbaik untuk audience Shorts."
  },

  {
    title: "Download hasil",
    description:
      "Setelah selesai, unduh MP4, SRT, dan caption SEO-friendly. Semua file output tersimpan lokal di browser untuk perangkat yang sama."
  }
] as const;

const QUICK_NOTES = [
  "Fokus app ini adalah YouTube Shorts voice over affiliate dengan hook cepat dan CTA kuat di bagian akhir.",
  "Di mobile, performa bisa lebih berat. Kalau render mulai lambat, pakai video lebih singkat dan tutup tab lain lebih dulu.",
  "Kalau tab direload atau tertutup saat render, job akan ditandai interrupted dan sebaiknya dijalankan ulang."
] as const;

export function TutorialPage() {
  return (
    <div className="page-shell tutorial-page">
      <section className="section-card tutorial-hero">
        <p className="page-kicker">
          <i className="ti ti-bolt" aria-hidden="true" />
          Tutorial cepat
        </p>
        <h2>Tutorial singkat aplikasi</h2>
        <p className="page-intro">
          Alur paling aman adalah: upload video produk pendek, analisis 6 frame, pilih
          kandidat clip terbaik, lalu render voice over affiliate langsung di browser.
        </p>
      </section>

      <section className="tutorial-grid" aria-label="Langkah penggunaan aplikasi">
        {TUTORIAL_STEPS.map((step, index) => (
          <article key={step.title} className="section-card tutorial-step">
            <div className="tutorial-step__index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </div>
            <div className="tutorial-step__copy">
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="section-card tutorial-notes">
        <div className="section-title">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <h3>Catatan penting</h3>
        </div>
        <div className="tutorial-note-list">
          {QUICK_NOTES.map((note) => (
            <div key={note} className="tutorial-note-item">
              <span className="tutorial-note-item__dot" aria-hidden="true" />
              <p>{note}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
