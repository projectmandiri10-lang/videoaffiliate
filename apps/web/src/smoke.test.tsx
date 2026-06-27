import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GeneratePage } from "./pages/GeneratePage";
import * as api from "./api";
import * as pipelineHook from "./lib/use-pipeline-state";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createJob: vi.fn(),
    deleteJob: vi.fn(),
    fetchSettings: vi.fn(),
    fetchTtsVoices: vi.fn(),
    previewTtsVoice: vi.fn(),
    reanalyzeJob: vi.fn(),
    replaceJobSource: vi.fn(),
    selectClip: vi.fn(),
    toArtifactObjectUrl: vi.fn(),
    updateSettings: vi.fn()
  };
});

vi.mock("./lib/use-pipeline-state", () => ({
  usePipelineState: vi.fn()
}));

function artifactRef(name: string) {
  return {
    artifactId: `artifact-${name}`,
    fileName: name,
    mimeType: name.endsWith(".txt")
      ? "text/plain"
      : name.endsWith(".srt")
        ? "application/x-subrip"
        : "video/mp4",
    size: 1024,
    storage: "idb" as const,
    createdAt: "2026-04-01T00:00:00.000Z"
  };
}

const mockSettings = {
  scriptModel: "gemini-3.5-flash",
  ttsModel: "gemini-2.5-flash-preview-tts",
  language: "id-ID" as const,
  maxVideoSeconds: 30,
  safetyMode: "safe_marketing" as const,
  ctaPosition: "end" as const,
  ctaMode: "random" as const,
  ctaSequence: {
    tiktok: 0,
    youtube: 0,
    facebook: 0,
    shopee: 0
  },
  concurrency: 1 as const,
  platforms: [
    { platformId: "tiktok" as const, enabled: true, voiceName: "Leda", speechRate: 1 },
    { platformId: "youtube" as const, enabled: true, voiceName: "Despina", speechRate: 1 },
    { platformId: "facebook" as const, enabled: true, voiceName: "Aoede", speechRate: 1 },
    { platformId: "shopee" as const, enabled: true, voiceName: "Kore", speechRate: 1 }
  ]
};

const mockVoices = {
  voices: [
    {
      voiceName: "Aoede",
      label: "Aoede",
      tone: "Breezy",
      gender: "female" as const
    },
    {
      voiceName: "Despina",
      label: "Despina",
      tone: "Smooth",
      gender: "female" as const
    },
    {
      voiceName: "Iapetus",
      label: "Iapetus",
      tone: "Clear",
      gender: "male" as const
    }
  ],
  excitedPresets: []
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pipelineHook.usePipelineState).mockReturnValue({
    initialized: true,
    jobs: [],
    settings: mockSettings,
    voices: mockVoices.voices
  });
  vi.mocked(api.fetchSettings).mockResolvedValue(mockSettings);
  vi.mocked(api.fetchTtsVoices).mockResolvedValue(mockVoices);
  vi.mocked(api.updateSettings).mockResolvedValue(mockSettings);
  vi.mocked(api.toArtifactObjectUrl).mockResolvedValue("blob:test");
});

describe("web smoke", () => {
  it("renders the simplified app shell without settings tab", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /voice over untuk youtube shorts affiliate video/i })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tutorial" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(
      screen.getByText(
        /upload video produk singkat, pilih potongan terbaik, lalu download hasil video/i
      )
    ).toBeTruthy();
    expect(screen.getByText(/hasil tersimpan di browser ini/i)).toBeTruthy();
  });

  it("opens the short tutorial page from the highlighted tutorial button", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Tutorial" }));

    expect(await screen.findByRole("heading", { name: /tutorial singkat aplikasi/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /pilih clip terbaik/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /download hasil/i })).toBeTruthy();
  });

  it("shows generate form validation before submit", async () => {
    render(<GeneratePage />);

    expect(await screen.findByRole("button", { name: /buat hasil video/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /buat hasil video/i }));

    expect(
      await screen.findByText(/Video, judul, deskripsi, dan affiliate link wajib diisi./i)
    ).toBeTruthy();
    expect(api.createJob).not.toHaveBeenCalled();
  });

  it("submits youtube-only job from generate page", async () => {
    vi.mocked(api.createJob).mockResolvedValue({
      jobId: "job-youtube-only",
      status: "queued"
    });

    render(<GeneratePage />);

    fireEvent.change(await screen.findByLabelText("Video"), {
      target: {
        files: [new File(["video"], "promo.mp4", { type: "video/mp4" })]
      }
    });
    fireEvent.change(screen.getByLabelText("Judul"), {
      target: { value: "Promo Pilihan" }
    });
    fireEvent.change(screen.getByLabelText("Deskripsi"), {
      target: { value: "Deskripsi pilihan platform" }
    });
    fireEvent.change(screen.getByLabelText("Affiliate Link"), {
      target: { value: "https://contoh-affiliate.test/pilihan" }
    });

    fireEvent.click(screen.getByRole("button", { name: /buat hasil video/i }));

    await waitFor(() => {
      expect(api.createJob).toHaveBeenCalledWith({
        video: expect.objectContaining({ name: "promo.mp4" }),
        title: "Promo Pilihan",
        description: "Deskripsi pilihan platform",
        affiliateLink: "https://contoh-affiliate.test/pilihan"
      });
    });
  });

  it("lets the user switch the featured youtube narrator voice", async () => {
    render(<GeneratePage />);

    fireEvent.click(await screen.findByRole("button", { name: /pria realistis/i }));

    await waitFor(() => {
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          platforms: expect.arrayContaining([
            expect.objectContaining({
              platformId: "youtube",
              voiceName: "Iapetus"
            })
          ])
        })
      );
    });
  });

  it("renders jobs page with clip candidates and final output", async () => {
    vi.mocked(pipelineHook.usePipelineState).mockReturnValue({
      initialized: true,
      settings: mockSettings,
      voices: mockVoices.voices,
      jobs: [
      {
        jobId: "job-1",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        title: "Job Satu",
        description: "Deskripsi Job",
        affiliateLink: "https://contoh-affiliate.test/job-1",
        videoPath: artifactRef("source.mp4"),
        videoMimeType: "video/mp4",
        videoDurationSec: 42,
        workflow: "youtube_shorts" as const,
        overallStatus: "success" as const,
        analysisStatus: "done" as const,
        clipCandidates: [
          {
            clipId: "clip_1",
            startSec: 0,
            endSec: 22,
            durationSec: 22,
            score: 8.8,
            reason: "Hook visual langsung terlihat.",
            previewPath: artifactRef("job-1-clip_1.mp4"),
            frameTimestamps: [1, 10, 20]
          }
        ],
        selectedClipId: "clip_1",
        finalRender: {
          status: "done" as const,
          scriptText: "Naskah final.",
          captionText: "Caption final.",
          hashtags: ["#shorts", "#affiliate"],
          mp4Path: artifactRef("job-1.mp4"),
          srtPath: artifactRef("job-1.srt"),
          captionPath: artifactRef("job-1-caption.txt"),
          updatedAt: "2026-04-01T00:00:00.000Z"
        },
        platforms: [
          {
            platformId: "youtube" as const,
            status: "done" as const,
            updatedAt: "2026-04-01T00:00:00.000Z",
            artifactPaths: []
          }
        ],
        runtime: {
          deviceMode: "desktop" as const,
          stage: "done" as const,
          progress: 1,
          statusMessage: "Render final selesai."
        }
      }
    ]
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Hasil" }));

    expect(await screen.findByRole("heading", { name: /video siap diunduh/i })).toBeTruthy();
    expect(screen.getByText("clip_1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /download mp4/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download srt/i })).toBeTruthy();
    expect(screen.getByText("Caption final.")).toBeTruthy();
  });
});
