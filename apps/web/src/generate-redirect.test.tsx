import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createJob: vi.fn(),
    deleteJob: vi.fn(),
    fetchSettings: vi.fn(),
    fetchJobs: vi.fn(),
    retryPlatform: vi.fn(),
    retryPlatformCaption: vi.fn(),
    retryPlatformJob: vi.fn(),
    updateJob: vi.fn(),
    updatePlatformMetadata: vi.fn()
  };
});

describe("generate redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchSettings).mockResolvedValue({
      scriptModel: "gemini/gemini-2.5-flash-image",
      ttsModel: "vertex_ai/gemini-2.5-flash-tts",
      language: "id-ID",
      maxVideoSeconds: 60,
      safetyMode: "safe_marketing",
      ctaPosition: "end",
      ctaMode: "random",
      ctaSequence: {
        tiktok: 0,
        youtube: 0,
        facebook: 0,
        shopee: 0
      },
      concurrency: 1,
      platforms: [
        { platformId: "tiktok", enabled: true, voiceName: "Leda", speechRate: 1 },
        { platformId: "youtube", enabled: true, voiceName: "Charon", speechRate: 1 },
        { platformId: "facebook", enabled: true, voiceName: "Aoede", speechRate: 1 },
        { platformId: "shopee", enabled: true, voiceName: "Kore", speechRate: 1 }
      ]
    });
    vi.mocked(api.fetchJobs).mockResolvedValue([]);
  });

  it("moves to jobs page and shows upload progress immediately", async () => {
    vi.mocked(api.createJob).mockImplementation(() => new Promise(() => {}));

    render(<App />);

    fireEvent.change(screen.getByLabelText("Video"), {
      target: {
        files: [new File(["video"], "promo.mp4", { type: "video/mp4" })]
      }
    });
    fireEvent.change(screen.getByLabelText("Judul"), {
      target: { value: "Promo Baru" }
    });
    fireEvent.change(screen.getByLabelText("Deskripsi"), {
      target: { value: "Deskripsi promo untuk testing" }
    });
    fireEvent.change(screen.getByLabelText("Affiliate Link"), {
      target: { value: "https://contoh.test/affiliate" }
    });

    fireEvent.click(screen.getByRole("button", { name: /generate platform terpilih/i }));

    expect(await screen.findByText(/mengirim job baru/i)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: /upload job promo baru/i
      })
    ).toBeTruthy();
  });
});
