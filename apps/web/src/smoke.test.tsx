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
    fetchJobDetail: vi.fn(),
    fetchJobs: vi.fn(),
    fetchSettings: vi.fn(),
    fetchTtsVoices: vi.fn(),
    openStyleOutputLocation: vi.fn(),
    previewTtsVoice: vi.fn(),
    retryStyle: vi.fn(),
    updateSettings: vi.fn()
  };
});

const mockSettings = {
  scriptModel: "gemini-3-flash-preview",
  ttsModel: "gemini-2.5-flash-preview-tts",
  language: "id-ID" as const,
  maxVideoSeconds: 60,
  safetyMode: "safe_marketing" as const,
  ctaPosition: "end" as const,
  concurrency: 1 as const,
  styles: [
    {
      styleId: "evergreen" as const,
      enabled: true,
      promptTemplate: "Prompt evergreen",
      voiceName: "Aoede",
      speechRate: 1
    },
    {
      styleId: "soft_selling" as const,
      enabled: true,
      promptTemplate: "Prompt soft selling",
      voiceName: "Leda",
      speechRate: 1
    },
    {
      styleId: "hard_selling" as const,
      enabled: true,
      promptTemplate: "Prompt hard selling",
      voiceName: "Kore",
      speechRate: 1
    },
    {
      styleId: "problem_solution" as const,
      enabled: true,
      promptTemplate: "Prompt problem solution",
      voiceName: "Puck",
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
  it("renders the app shell and settings voice dropdown", async () => {
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
  });

  it("shows generate form validation before submit", async () => {
    render(<GeneratePage />);

    expect(await screen.findByRole("button", { name: /generate job/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /generate job/i }));

    expect(
      await screen.findByText(
        /Video, judul, deskripsi, affiliate link, voice, dan style wajib diisi./i
      )
    ).toBeTruthy();
    expect(api.createJob).not.toHaveBeenCalled();
  });
});
