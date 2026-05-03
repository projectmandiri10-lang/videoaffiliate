import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GeneratePage } from "./pages/GeneratePage";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createJob: vi.fn(),
    deleteJob: vi.fn(),
    fetchJobDetail: vi.fn(),
    fetchJobs: vi.fn(),
    fetchSettings: vi.fn(),
    fetchTtsVoices: vi.fn(),
    openPlatformOutputLocation: vi.fn(),
    previewTtsVoice: vi.fn(),
    retryPlatform: vi.fn(),
    updateJob: vi.fn(),
    updateSettings: vi.fn()
  };
});

const mockSettings = {
  scriptModel: "google/gemini-3-flash-preview",
  ttsModel: "gemini-2.5-flash-preview-tts",
  language: "id-ID" as const,
  maxVideoSeconds: 60,
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
    {
      platformId: "tiktok" as const,
      enabled: true,
      voiceName: "Leda",
      speechRate: 1
    },
    {
      platformId: "youtube" as const,
      enabled: true,
      voiceName: "Charon",
      speechRate: 1
    },
    {
      platformId: "facebook" as const,
      enabled: true,
      voiceName: "Aoede",
      speechRate: 1
    },
    {
      platformId: "shopee" as const,
      enabled: true,
      voiceName: "Kore",
      speechRate: 1
    }
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
      voiceName: "Leda",
      label: "Leda",
      tone: "Youthful",
      gender: "female" as const
    },
    {
      voiceName: "Puck",
      label: "Puck",
      tone: "Upbeat",
      gender: "male" as const
    }
  ],
  excitedPresets: [
    {
      presetId: "female_excited_v1",
      label: "Excited Wanita V1",
      version: "v1",
      gender: "female" as const,
      voiceName: "Leda"
    }
  ]
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchSettings).mockResolvedValue(mockSettings);
  vi.mocked(api.fetchTtsVoices).mockResolvedValue(mockVoices);
  vi.mocked(api.fetchJobs).mockResolvedValue([]);
  vi.mocked(api.updateSettings).mockResolvedValue(mockSettings);
});

describe("web smoke", () => {
  it("renders the app shell and settings platform voice dropdown", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /voice over video generator/i })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByDisplayValue(mockSettings.scriptModel)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByRole("option", { name: /Aoede - Breezy/i }).length).toBeGreaterThan(
        0
      );
    });
    expect(screen.getByDisplayValue("Random")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /TikTok/i })).toBeTruthy();
  });

  it("shows generate form validation before submit", async () => {
    render(<GeneratePage />);

    expect(await screen.findByRole("button", { name: /generate all platforms/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /generate all platforms/i }));

    expect(
      await screen.findByText(/Video, judul, deskripsi, dan affiliate link wajib diisi./i)
    ).toBeTruthy();
    expect(api.createJob).not.toHaveBeenCalled();
  });

  it("renders jobs page with multi-platform detail rows", async () => {
    vi.mocked(api.fetchJobs).mockResolvedValue([
      {
        jobId: "job-1",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        title: "Job Satu",
        description: "Deskripsi Job",
        affiliateLink: "https://contoh-affiliate.test/job-1",
        videoPath: "C:/video.mp4",
        videoMimeType: "video/mp4",
        videoDurationSec: 20,
        overallStatus: "failed",
        platforms: [
          {
            platformId: "tiktok",
            status: "failed",
            updatedAt: "2026-04-01T00:00:00.000Z",
            errorMessage: "fetch failed",
            retryAfter: "2099-04-01T00:00:00.000Z",
            artifactPaths: []
          },
          {
            platformId: "youtube",
            status: "pending",
            updatedAt: "2026-04-01T00:00:00.000Z",
            artifactPaths: []
          },
          {
            platformId: "facebook",
            status: "pending",
            updatedAt: "2026-04-01T00:00:00.000Z",
            artifactPaths: []
          },
          {
            platformId: "shopee",
            status: "pending",
            updatedAt: "2026-04-01T00:00:00.000Z",
            artifactPaths: []
          }
        ]
      }
    ]);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));

    expect(await screen.findByRole("heading", { name: /detail job/i })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /job baru/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Job Satu").length).toBeGreaterThan(0);
    expect(screen.getByText("TikTok")).toBeTruthy();
    expect(screen.getByText("Shopee")).toBeTruthy();
    expect(screen.getByRole("button", { name: /hapus job/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /retry/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
