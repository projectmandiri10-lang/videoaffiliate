import { describe, expect, it } from "vitest";
import {
  ensureSocialMetadata,
  extractAudioFromResponse,
  extractSocialMetadata,
  extractScriptText
} from "../src/utils/model-output.js";

describe("model output parser", () => {
  it("extracts script from code fence json", () => {
    const response = {
      text: "```json\n{\"script\":\"Halo ini script.\"}\n```"
    };
    expect(extractScriptText(response)).toBe("Halo ini script.");
  });

  it("extracts script from candidates text", () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [{ text: "Script langsung dari candidates." }]
          }
        }
      ]
    };
    expect(extractScriptText(response)).toContain("Script langsung");
  });

  it("extracts script from openai-compatible message content", () => {
    const response = {
      choices: [
        {
          message: {
            content: "Naskah dari SnifoxAI."
          }
        }
      ]
    };
    expect(extractScriptText(response)).toBe("Naskah dari SnifoxAI.");
  });

  it("extracts base64 audio", () => {
    const base64 = Buffer.from("test-audio").toString("base64");
    const response = {
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: base64, mimeType: "audio/wav" } }]
          }
        }
      ]
    };
    const audio = extractAudioFromResponse(response);
    expect(audio.data.toString("utf8")).toBe("test-audio");
    expect(audio.mimeType).toBe("audio/wav");
  });

  it("extracts openai-compatible audio payload", () => {
    const base64 = Buffer.from("pcm-audio").toString("base64");
    const response = {
      choices: [
        {
          message: {
            audio: {
              data: base64,
              transcript: "Voice transcript"
            }
          }
        }
      ]
    };
    const audio = extractAudioFromResponse(response);
    expect(audio.data.toString("utf8")).toBe("pcm-audio");
    expect(audio.mimeType).toBe("audio/pcm");
  });

  it("extracts social metadata from json", () => {
    const response = {
      text: '{"caption":"Produk praktis buat harian kamu. Klik untuk lihat detail!","hashtags":["#reelsfacebook","#affiliate","#produkviral"]}'
    };
    const social = extractSocialMetadata(response);
    expect(social.caption).toContain("Produk praktis");
    expect(social.hashtags).toContain("#affiliate");
  });

  it("extracts social metadata from openai-compatible json text", () => {
    const response = {
      choices: [
        {
          message: {
            content:
              '{"caption":"Produk hemat buat harian kamu.","hashtags":["#hemat","#affiliate"]}'
          }
        }
      ]
    };
    const social = extractSocialMetadata(response);
    expect(social.caption).toContain("Produk hemat");
    expect(social.hashtags).toEqual(["#hemat", "#affiliate"]);
  });

  it("cleans nested json stored inside caption text", () => {
    const response = {
      text: JSON.stringify({
        caption: JSON.stringify({
          caption: "Caption bersih dari nested JSON. #affiliate",
          hashtags: [" g", "#affiliate", "#PlanterBag"]
        }),
        hashtags: ["#mediatanam", "#affiliate"]
      })
    };

    const social = extractSocialMetadata(response);

    expect(social.caption).toBe("Caption bersih dari nested JSON.");
    expect(social.hashtags).toEqual(["#affiliate", "#planterbag", "#mediatanam"]);
  });

  it("normalizes caption with inline hashtags and removes duplicates", () => {
    const social = extractSocialMetadata({
      text: "Caption manual #Affiliate #Affiliate\n#PlanterBag #AI"
    });

    expect(social.caption).toBe("Caption manual");
    expect(social.hashtags).toEqual(["#affiliate", "#planterbag", "#ai"]);
  });

  it("falls back to default metadata if hashtags empty", () => {
    const candidate = {
      caption: "Caption saja tanpa hashtag",
      hashtags: []
    };
    const social = ensureSocialMetadata(candidate, "Fallback caption", [
      "#reelsfacebook",
      "#affiliate"
    ]);
    expect(social.caption).toContain("Caption saja");
    expect(social.hashtags.length).toBeGreaterThan(0);
  });
});
