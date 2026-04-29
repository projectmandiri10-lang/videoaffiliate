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
    fetchJobs: vi.fn(),
    retryPlatform: vi.fn(),
    updateJob: vi.fn()
  };
});

describe("generate redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    fireEvent.click(screen.getByRole("button", { name: /generate all platforms/i }));

    expect(await screen.findByText(/mengirim job baru/i)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: /upload job promo baru/i
      })
    ).toBeTruthy();
  });
});
