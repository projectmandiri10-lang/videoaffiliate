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
    replaceJobSource: vi.fn(),
    retryPlatform: vi.fn(),
    retryPlatformCaption: vi.fn(),
    retryPlatformJob: vi.fn(),
    updateJob: vi.fn(),
    updatePlatformMetadata: vi.fn(),
    updateSettings: vi.fn()
  };
});

const mockSettings = {
  scriptModel: "google/gemini-3-flash-preview",
  ttsModel: "vertex_ai/gemini-2.5-flash-tts",
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
        overallStatus: "running",
        platforms: [
          {
            platformId: "tiktok",
            status: "running",
            updatedAt: "2026-05-10T10:00:00.000Z",
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
    expect(screen.getByRole("progressbar", { name: /progress render tiktok/i })).toBeTruthy();
    expect(screen.getAllByText(/progress render/i).length).toBeGreaterThan(0);
  });

  it("hides legacy srt links and shows only mp4 plus caption outputs", async () => {
    vi.mocked(api.fetchJobs).mockResolvedValue([
      {
        jobId: "job-legacy-srt",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        title: "Job Legacy",
        description: "Deskripsi legacy",
        affiliateLink: "https://contoh-affiliate.test/job-legacy",
        videoPath: "C:/video.mp4",
        videoMimeType: "video/mp4",
        videoDurationSec: 20,
        overallStatus: "success",
        platforms: [
          {
            platformId: "tiktok",
            status: "done",
            updatedAt: "2026-04-01T00:00:00.000Z",
            mp4Path: "/outputs/tiktok/job-legacy.mp4",
            captionPath: "/outputs/tiktok/job-legacy-caption.txt",
            srtPath: "/outputs/tiktok/job-legacy.srt",
            visualAuditStatus: "skipped",
            artifactPaths: [
              "/outputs/tiktok/job-legacy.mp4",
              "/outputs/tiktok/job-legacy-caption.txt",
              "/outputs/tiktok/job-legacy.srt"
            ]
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

    expect(await screen.findByText(/Tersedia: MP4, Caption TXT/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "MP4" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Caption TXT" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "SRT" })).toBeNull();
    expect(screen.getByText("Audit: reference native")).toBeTruthy();
  });

  it("edits platform metadata and renders per-platform caption actions", async () => {
    const job = {
      jobId: "job-2",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      title: "Job Dua",
      description: "Deskripsi Job Dua",
      affiliateLink: "https://contoh-affiliate.test/job-2",
      videoPath: "C:/video.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 20,
      overallStatus: "success" as const,
      platforms: [
        {
          platformId: "tiktok" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          scriptText: "Script tersedia",
          captionText: "Caption bersih.",
          hashtags: ["#affiliate"],
          artifactPaths: []
        },
        {
          platformId: "youtube" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        },
        {
          platformId: "facebook" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        },
        {
          platformId: "shopee" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        }
      ]
    };
    const updatedJob = {
      ...job,
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              titleOverride: "Judul TikTok",
              descriptionOverride: "Deskripsi TikTok",
              affiliateLinkOverride: "https://contoh-affiliate.test/tiktok",
              captionText: "Caption edit.",
              hashtags: ["#edit"]
            }
          : platform
      )
    };
    vi.mocked(api.fetchJobs).mockResolvedValue([job]);
    vi.mocked(api.updatePlatformMetadata).mockResolvedValue(updatedJob);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));

    expect(await screen.findByText("Caption bersih.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /retry caption/i }).length).toBeGreaterThan(0);
    const editButton = screen.getAllByRole("button", { name: "Edit" })[0];
    if (!editButton) {
      throw new Error("Edit button not found");
    }
    fireEvent.click(editButton);
    await screen.findByRole("button", { name: /simpan platform/i });
    fireEvent.change(screen.getByDisplayValue("Caption bersih."), {
      target: { value: "Caption edit." }
    });
    fireEvent.change(screen.getByDisplayValue("#affiliate"), {
      target: { value: "#edit" }
    });
    fireEvent.click(screen.getByRole("button", { name: /simpan platform/i }));

    await waitFor(() => {
      expect(api.updatePlatformMetadata).toHaveBeenCalledWith("job-2", "tiktok", {
        title: "Job Dua",
        description: "Deskripsi Job Dua",
        affiliateLink: "https://contoh-affiliate.test/job-2",
        captionText: "Caption edit.",
        hashtags: ["#edit"]
      });
    });
  });

  it("replaces job source and clears stale output links", async () => {
    const job = {
      jobId: "job-source",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      title: "Job Source",
      description: "Deskripsi Job Source",
      affiliateLink: "https://contoh-affiliate.test/job-source",
      videoPath: "C:/uploads/job-source/source.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 21,
      overallStatus: "partial_success" as const,
      platforms: [
        {
          platformId: "tiktok" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          mp4Path: "/outputs/tiktok/job-source.mp4",
          captionPath: "/outputs/tiktok/job-source-caption.txt",
          captionText: "Caption lama.",
          hashtags: ["#lama"],
          artifactPaths: [
            "/outputs/tiktok/job-source.mp4",
            "/outputs/tiktok/job-source-caption.txt"
          ]
        },
        {
          platformId: "youtube" as const,
          status: "failed" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        },
        {
          platformId: "facebook" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        },
        {
          platformId: "shopee" as const,
          status: "done" as const,
          updatedAt: "2026-04-01T00:00:00.000Z",
          artifactPaths: []
        }
      ]
    };
    const updatedJob = {
      ...job,
      updatedAt: "2026-04-02T00:00:00.000Z",
      videoPath: "C:/uploads/job-source/source.webm",
      videoMimeType: "video/webm",
      videoDurationSec: 18,
      overallStatus: "failed" as const,
      platforms: job.platforms.map((platform) => ({
        ...platform,
        status: "failed" as const,
        errorMessage: "Source video diganti. Klik Retry Job untuk membuat output baru.",
        mp4Path: undefined,
        captionPath: undefined,
        captionText: undefined,
        hashtags: undefined,
        artifactPaths: []
      }))
    };
    vi.mocked(api.fetchJobs).mockResolvedValueOnce([job]).mockResolvedValue([updatedJob]);
    vi.mocked(api.replaceJobSource).mockResolvedValue(updatedJob);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));

    expect(await screen.findByRole("button", { name: /ganti source/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: "MP4" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /ganti source/i }));

    const fileInput = await screen.findByLabelText(/video source baru/i);
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["new-video"], "replacement.webm", { type: "video/webm" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: /simpan source baru/i }));

    await waitFor(() => {
      expect(api.replaceJobSource).toHaveBeenCalledWith(
        "job-source",
        expect.objectContaining({
          name: "replacement.webm"
        })
      );
    });
    expect(
      await screen.findByText(
        /Source utama berhasil diganti. Output lama dibersihkan, lalu gunakan Retry Job per platform untuk render ulang./i
      )
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "MP4" })).toBeNull();
    expect(screen.getAllByText(/Klik Retry Job untuk membuat output baru./i).length).toBeGreaterThan(
      0
    );
  });
});
