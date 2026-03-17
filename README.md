# Auto SRT + Voice Over (Gemini)

Aplikasi untuk otomatisasi:
- input: `video + judul + deskripsi + affiliate link`
- output per style: `.srt`, `.wav` (24kHz mono), `.mp4` (video + voice-over), dan `caption + hashtags` siap upload Facebook Reels (juga tersimpan sebagai file `.txt`)
- style default: `evergreen`, `soft_selling`, `hard_selling`, `problem_solution`

## Stack
- Frontend: React + Vite + TypeScript
- Backend: Fastify + TypeScript
- AI: Gemini (`@google/genai`)
- Media: `ffmpeg-static` + `ffprobe-static` (tanpa install FFmpeg global)
- Runtime aplikasi: Node.js (Python tidak dipakai untuk runtime aplikasi ini)

## Struktur
- `apps/server`: API + job processor
- `apps/web`: UI
- `data/settings.json`: konfigurasi model/prompt/voice
- `data/jobs.json`: metadata 20 job terakhir
- `outputs/<jobId>`: file hasil `.srt`, `.wav`, `.mp4`, dan `*-caption.txt`
- `uploads/<jobId>`: video source upload

## Setup
1. Install dependency:
```bash
npm install
```
2. Buat `.env` dari contoh:
```bash
copy .env.example .env
```
3. Isi `GEMINI_API_KEY` di `.env`.

## Menjalankan (dev)
```bash
npm run dev
```

Default:
- Backend API: `http://localhost:8787`
- Frontend UI: `http://localhost:5173`

Alternatif (Windows launcher):
- `start-dev.bat`: jalankan server + frontend bersamaan
- `start-server.bat`: jalankan server saja
- `start-frontend.bat`: jalankan frontend saja

## Menjalankan Dev Dari Laptop + Android (LAN)
1. Cari IP laptop di jaringan Wi-Fi yang sama (contoh `192.168.1.20`).
2. Set `WEB_ORIGIN` di `.env`, contoh:
```env
WEB_ORIGIN=http://localhost:5173,http://192.168.1.20:5173
```
3. Jalankan `npm run dev`.
4. Buka dari HP Android (Chrome): `http://192.168.1.20:5173`.

Catatan:
- Vite dev server sudah listen ke `0.0.0.0` agar bisa diakses dari perangkat LAN.
- Frontend dev otomatis memakai hostname browser aktif ke backend port `8787`.

## Menjalankan (build + start)
```bash
npm run build
npm run start
```

## Deploy ke cPanel Node.js App (Single Service)
1. Upload source project (tanpa folder cache lokal seperti `node_modules`).
2. Buat `.env` di server:
```env
GEMINI_API_KEY=...
PORT=<port_dari_cpanel>
WEB_ORIGIN=https://domain-anda
```
3. Install dependency:
```bash
npm install
```
4. Build aplikasi:
```bash
npm run build
```
5. Start aplikasi:
```bash
npm run start
```
6. Pastikan folder berikut writable oleh proses app: `data/`, `uploads/`, `outputs/`, `logs/`.
7. Verifikasi:
- `GET https://domain-anda/api/health`
- buka UI di `https://domain-anda`
- buat job, lalu cek link output (MP4/WAV/SRT/TXT) di tab `Jobs`

## Endpoint API
- `GET /api/health`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/jobs` (multipart: `video`, `title`, `description`)
- `GET /api/jobs`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/retry` body `{ "styleId": "evergreen" | "soft_selling" | "hard_selling" | "problem_solution" }`
- `POST /api/jobs/:jobId/open-location` body `{ "styleId": "evergreen" | "soft_selling" | "hard_selling" | "problem_solution" }` (opsional untuk environment Windows)

## Catatan Operasional
- Maks durasi video default: 60 detik (ubah di settings).
- Proses style berjalan berurutan (sequential).
- Jika satu style gagal, style lain tetap lanjut.
- Riwayat job otomatis dipangkas maksimal 20 entry.
- Log tersimpan di `logs/app.log`.
- Output file di tab `Jobs` tersedia sebagai link langsung (browser-friendly untuk desktop dan Android).
- Form `Generate` menyediakan kotak `Affiliate Link`.
- Tab `Jobs` menampilkan caption final siap copy (caption + hashtag + affiliate link job).

## Testing
```bash
npm run test
```
