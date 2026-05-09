function stripCodeFence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split("\n");
  if (lines.length <= 2) {
    return trimmed.replace(/```/g, "").trim();
  }
  const withoutFence = lines.slice(1, lines[lines.length - 1]?.startsWith("```") ? -1 : undefined);
  return withoutFence.join("\n").trim();
}

function parseJsonValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  const parsed = parseJsonValue(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return undefined;
}

function parseJsonScript(raw: string): string | undefined {
  const object = parseJsonObject(raw);
  if (object) {
    const maybeScript = object.script;
    if (typeof maybeScript === "string") {
      return maybeScript.trim();
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      return parsed.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeCaption(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text;
}

function normalizeHashtag(tag: string): string | undefined {
  const cleaned = tag.replace(/[^\w#]/g, "").trim();
  if (!cleaned) {
    return undefined;
  }
  const withHash = cleaned.startsWith("#") ? cleaned : `#${cleaned}`;
  if (withHash.replace(/^#/, "").length < 2) {
    return undefined;
  }
  return withHash.toLowerCase();
}

function sanitizeHashtags(raw: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = normalizeHashtag(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= 12) {
      break;
    }
  }
  return result;
}

function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_]+/g) ?? [];
  return sanitizeHashtags(matches);
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseNestedSocialObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  let current = stripCodeFence(value);
  for (let depth = 0; depth < 3; depth += 1) {
    const parsed = parseJsonValue(current);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed !== "string") {
      return undefined;
    }
    current = stripCodeFence(parsed);
  }

  return undefined;
}

export function normalizeSocialMetadata(
  candidate: { caption?: unknown; hashtags?: unknown },
  fallbackCaption = "",
  fallbackHashtags: string[] = []
): {
  caption: string;
  hashtags: string[];
} {
  const nested = parseNestedSocialObject(candidate.caption);
  const captionSource = nested ? nested.caption : candidate.caption;
  const captionText = typeof captionSource === "string" ? captionSource : "";
  const cleanCaption =
    sanitizeCaption(captionText).replace(/#[a-zA-Z0-9_]+/g, "").replace(/\s+/g, " ").trim() ||
    sanitizeCaption(fallbackCaption);

  const hashtags = sanitizeHashtags([
    ...coerceStringArray(nested?.hashtags),
    ...coerceStringArray(candidate.hashtags),
    ...extractHashtagsFromText(captionText),
    ...fallbackHashtags
  ]);

  return {
    caption: cleanCaption,
    hashtags
  };
}

function extractTextFromOpenAiMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }

      if ((part as { type?: string }).type === "text") {
        return String((part as { text?: string }).text || "").trim();
      }

      return "";
    })
    .filter((value) => value.length > 0)
    .join("\n")
    .trim();
}

export function extractSocialMetadata(response: unknown): {
  caption: string;
  hashtags: string[];
} {
  const raw = extractTextFromResponse(response);
  const stripped = stripCodeFence(raw);
  const json = parseJsonObject(stripped);
  if (json) {
    return normalizeSocialMetadata({
      caption: json.caption,
      hashtags: json.hashtags
    });
  }

  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const captionLine = lines.find((line) => !line.startsWith("#")) ?? stripped;
  return normalizeSocialMetadata({
    caption: captionLine,
    hashtags: extractHashtagsFromText(stripped)
  });
}

export function ensureSocialMetadata(
  candidate: { caption: string; hashtags: string[] },
  fallbackCaption: string,
  fallbackHashtags: string[]
): { caption: string; hashtags: string[] } {
  const normalized = normalizeSocialMetadata(candidate, fallbackCaption, fallbackHashtags);
  if (normalized.hashtags.length) {
    return normalized;
  }
  return {
    ...normalized,
    hashtags: sanitizeHashtags(fallbackHashtags)
  };
}

export function extractTextFromResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    return "";
  }

  const choices = (response as { choices?: unknown[] }).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as { message?: { content?: unknown; audio?: { transcript?: string } } })
      ?.message;
    const text = extractTextFromOpenAiMessageContent(message?.content);
    if (text) {
      return text;
    }

    const transcript = String(message?.audio?.transcript || "").trim();
    if (transcript) {
      return transcript;
    }
  }

  const maybeText = (response as { text?: unknown }).text;
  if (typeof maybeText === "string") {
    return maybeText.trim();
  }
  if (typeof maybeText === "function") {
    const value = maybeText();
    if (typeof value === "string") {
      return value.trim();
    }
  }

  const candidates = (response as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates) || !candidates.length) {
    return "";
  }

  const parts =
    (candidates[0] as { content?: { parts?: Array<{ text?: string }> } })?.content?.parts ??
    [];
  const texts = parts
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
  return texts.join("\n").trim();
}

export function extractScriptText(response: unknown): string {
  const raw = extractTextFromResponse(response);
  if (!raw) {
    return "";
  }
  const stripped = stripCodeFence(raw);
  const fromJson = parseJsonScript(stripped);
  if (fromJson) {
    return fromJson;
  }
  return stripped
    .replace(/\[.*?scene.*?\]/gi, "")
    .replace(/\(.*?scene.*?\)/gi, "")
    .trim();
}

export interface ExtractedAudio {
  data: Buffer;
  mimeType: string;
}

export function extractAudioFromResponse(response: unknown): ExtractedAudio {
  const openAiAudio = (
    response as {
      choices?: Array<{
        message?: {
          audio?: {
            data?: string;
          };
        };
      }>;
    }
  )?.choices?.[0]?.message?.audio;

  if (openAiAudio?.data) {
    return {
      data: Buffer.from(openAiAudio.data, "base64"),
      mimeType: "audio/pcm"
    };
  }

  const candidates = (response as { candidates?: unknown[] })?.candidates;
  if (!Array.isArray(candidates) || !candidates.length) {
    throw new Error("Respons TTS tidak memiliki kandidat audio.");
  }

  const parts =
    (candidates[0] as {
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    })?.content?.parts ?? [];

  for (const part of parts) {
    const inline = part.inlineData;
    if (!inline?.data) {
      continue;
    }
    return {
      data: Buffer.from(inline.data, "base64"),
      mimeType: inline.mimeType || "audio/wav"
    };
  }

  throw new Error("Data audio tidak ditemukan pada respons TTS.");
}
