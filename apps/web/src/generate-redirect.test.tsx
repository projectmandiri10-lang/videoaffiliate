import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import * as api from "./api";
import * as pipelineHook from "./lib/use-pipeline-state";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    createJob: vi.fn(),
    fetchSettings: vi.fn(),
    updateSettings: vi.fn()
  };
});

vi.mock("./lib/use-pipeline-state", () => ({
  usePipelineState: vi.fn()
}));

describe("generate redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pipelineHook.usePipelineState).mockReturnValue({
      initialized: true,
      jobs: [],
      settings: {
        scriptModel: "gemini-3.5-flash",
        ttsModel: "gemini-2.5-flash-preview-tts",
        language: "id-ID",
        maxVideoSeconds: 30,
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
          { platformId: "youtube", enabled: true, voiceName: "Despina", speechRate: 1 },
          { platformId: "facebook", enabled: true, voiceName: "Aoede", speechRate: 1 },
          { platformId: "shopee", enabled: true, voiceName: "Kore", speechRate: 1 }
        ]
      },
      voices: []
    });
    vi.mocked(api.fetchSettings).mockResolvedValue({
      scriptModel: "gemini-3.5-flash",
      ttsModel: "gemini-2.5-flash-preview-tts",
      language: "id-ID",
      maxVideoSeconds: 30,
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
        { platformId: "youtube", enabled: true, voiceName: "Despina", speechRate: 1 },
        { platformId: "facebook", enabled: true, voiceName: "Aoede", speechRate: 1 },
        { platformId: "shopee", enabled: true, voiceName: "Kore", speechRate: 1 }
      ]
    });
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

    fireEvent.click(screen.getByRole("button", { name: /buat hasil video/i }));

    expect(await screen.findByText(/mengirim video baru/i)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: /upload job promo baru/i
      })
    ).toBeTruthy();
  });
});
