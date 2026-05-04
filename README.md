# Auto Voice Over + Caption (Snifox Gateway + Gemini)

Aplikasi untuk otomatisasi:
- input: `video + judul + deskripsi + affiliate link`
- output per platform: `.mp4` (video + voice-over) dan `caption + hashtags` siap upload (tersimpan sebagai file `-caption.txt`)
- style default: `evergreen`, `soft_selling`, `hard_selling`, `problem_solution`

## Stack
- Frontend: React + Vite + TypeScript
- Backend: Fastify + TypeScript
- AI: Snifox gateway (OpenAI-compatible) untuk script/caption + Gemini native untuk TTS voice-over, dengan fallback otomatis ke model text-only lain di gateway dan voice Windows lokal saat provider utama gagal
- Media: `ffmpeg-static` + `ffprobe-static` (tanpa install FFmpeg global)
- Runtime aplikasi: Node.js (Python tidak dipakai untuk runtime aplikasi ini)

## Struktur
- `apps/server`: API + job processor
- `apps/web`: UI
- `data/settings.json`: konfigurasi model/prompt/voice
- `data/jobs.json`: metadata 20 job terakhir
- `outputs/<platformId>`: file hasil `.mp4` dan `*-caption.txt`
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
3. Isi `SNIFOX_API_BASE`, `SNIFOX_API_KEY`, dan `GEMINI_TTS_API_KEY` di `.env`.

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
2. Default `.env` di repo ini cukup:
```env
WEB_ORIGIN=http://localhost:5173
```
3. Jika ingin diakses dari Android/LAN, tambahkan origin browser HP juga, contoh:
```env
WEB_ORIGIN=http://localhost:5173,http://192.168.1.20:5173
```
4. Jalankan `npm run dev`.
5. Buka dari HP Android (Chrome): `http://192.168.1.20:5173`.

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
SNIFOX_API_BASE=https://core.snifoxai.com/v1
SNIFOX_API_KEY=snfx-your-api-key
GEMINI_TTS_API_KEY=...
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
- buat job, lalu cek link output `MP4` dan `Caption TXT` di tab `Jobs`

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
- `scriptModel` harus memakai ID model SnifoxAI lengkap yang aktif di gateway. Contoh default project ini: `google/gemini-3-flash-preview`.
- `ttsModel` tetap model Gemini direct untuk voice-over, contoh `gemini-2.5-flash-preview-tts`.
- Jika model utama sedang gagal atau unavailable di gateway, server otomatis fallback ke model text-only lain yang masih tersedia agar caption/script tetap jalan.
- Jika Gemini TTS mengembalikan `403 PERMISSION_DENIED` atau gagal di runtime, server hanya fallback ke Windows local TTS bila Windows punya voice Indonesia. Jika voice Indonesia tidak ada, proses akan gagal dengan pesan yang jelas agar tidak diam-diam menghasilkan aksen Inggris.
- `SNIFOX_API_BASE` harus menunjuk ke endpoint OpenAI-compatible yang aktif, dan env repo ini saat ini memakai `https://core.snifoxai.com/v1`.
- Daftar model aktif bisa dicek lewat endpoint `GET /models` pada gateway Anda.
- Dokumentasi gateway default repo ini: `https://snifoxai.com/docs`

## Testing
```bash
npm run test
```
