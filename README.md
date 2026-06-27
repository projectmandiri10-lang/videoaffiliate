# YouTube Shorts Clippers Workflow

Versi terbaru project ini memakai arsitektur browser-local untuk Cloudflare free tier:
- frontend React di Cloudflare Pages
- proxy LiteLLM di Cloudflare Pages Functions untuk route Gemini
- analisis video, preview clip, dan render final berjalan di browser user dengan `ffmpeg.wasm`
- job, settings, dan artifact disimpan lokal di browser lewat `IndexedDB + OPFS`

Legacy backend Fastify masih dipertahankan di repo sebagai fallback lokal, tetapi jalur deploy Cloudflare tidak bergantung pada backend itu.

## Workflow Baru
1. User upload video lokal.
2. Browser mengekstrak frame dan membuat kandidat clip lokal.
3. Browser kirim frame ringkas ke `/api/ai/*` Cloudflare Functions untuk scoring, script, caption, dan TTS Gemini via LiteLLM.
4. Browser merender preview dan output final lokal.
5. User download `.mp4`, `.srt`, dan caption `.txt` langsung dari browser.

Catatan:
- Tab harus tetap terbuka selama analisis atau render berjalan.
- Mobile memakai mode terbatas: max `30 detik`, max `80 MB`, render `720p`.
- Desktop juga dikunci ke max `30 detik` agar hook, CTA, dan render browser tetap cepat untuk YouTube Shorts affiliate.

## Stack
- Frontend: React + Vite + TypeScript
- Shared core: `packages/core`
- Browser media engine: `@ffmpeg/ffmpeg` + `@ffmpeg/util`
- Cloudflare layer: Pages + Pages Functions
- Legacy backend: Fastify + TypeScript

## Local Setup
1. Install dependency:
```bash
npm install
```
2. Buat `.env` dari contoh:
```bash
copy .env.example .env
```
3. Isi `.env` untuk mode legacy/local:
```env
LITELLM_BASE_URL=http://127.0.0.1:4000
LITELLM_API_KEY=...
PORT=8787
WEB_ORIGIN=http://localhost:5173
```

Catatan:
- `LITELLM_BASE_URL` akan dinormalisasi otomatis ke suffix `/v1` bila belum ada.
- Jika proxy LiteLLM Anda tidak memakai auth, `LITELLM_API_KEY` boleh dikosongkan dan app akan memakai placeholder internal.
- Alias `OPENAI_BASE_URL` dan `OPENAI_API_KEY` juga didukung bila Anda ingin menyamakan kontrak env dengan client OpenAI-compatible lain.

## Menjalankan

### Web app
```bash
npm run dev -w apps/web
```

### Legacy backend fallback
```bash
npm run dev -w apps/server
```

### Full legacy mode
```bash
npm run dev
```

## Cloudflare Pages Deploy
1. Hubungkan repo ini ke Cloudflare Pages.
2. Set build command:
```bash
npm install && npm run build -w apps/web
```
3. Set build output directory:
```bash
apps/web/dist
```
4. Tambahkan environment variable Pages Functions:
```env
LITELLM_BASE_URL=https://litellm.example.com
LITELLM_API_KEY=...
```
5. Pastikan folder `/functions` ikut terdeploy dari root project.
6. Repo ini sekarang punya `prebuild` self-healing untuk Rollup native binary, jadi kalau Cloudflare/npm melewatkan optional dependency platform-specific, build web akan mencoba memasang paket Rollup yang sesuai platform sebelum `vite build`.

Route proxy yang tersedia:
- `POST /api/ai/analyze`
- `POST /api/ai/script`
- `POST /api/ai/metadata`
- `POST /api/ai/tts`
- `GET /api/tts/voices`

## Scripts
- `npm run build`
- `npm run test -w apps/web`
- `npm run typecheck:functions`

## Testing
Web regression yang sudah diverifikasi:
```bash
npm run test -w apps/web
```

Catatan:
- Root `npm test` masih ikut menjalankan suite backend lama.
- Saat ini masih ada failure pre-existing di backend test `visual-audit` pada Windows (`timeout/EBUSY`) yang tidak terkait jalur Cloudflare browser-local.
