import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { GenerateSpeechInput, SpeechGenerator } from "../types.js";
import { findTtsVoiceByName } from "../constants.js";

interface PowerShellInput {
  allowAnyVoice: boolean;
  outputPath: string;
  preferredCulturePrefix: string;
  preferredGender?: "male" | "female" | "neutral";
  rate: number;
  textPath: string;
  voiceName: string;
}

type PowerShellRunner = (input: PowerShellInput) => Promise<void>;

function clampRate(speechRate: number): number {
  const normalized = Math.round((speechRate - 1) * 5);
  return Math.max(-10, Math.min(10, normalized));
}

async function runPowerShellTts(input: PowerShellInput): Promise<void> {
  const scriptPath = path.join(path.dirname(input.outputPath), "generate-tts.ps1");
  const script = [
    "param(",
    "  [string]$AllowAnyVoiceFlag,",
    "  [string]$TextPath,",
    "  [string]$OutputPath,",
    "  [string]$PreferredCulturePrefix,",
    "  [string]$PreferredGender,",
    "  [int]$RateValue,",
    "  [string]$RequestedVoice",
    ")",
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$allowAnyVoice = $AllowAnyVoiceFlag -eq '1'",
    "$text = [System.IO.File]::ReadAllText($TextPath, [System.Text.Encoding]::UTF8)",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$voices = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo })",
    "$selectedVoice = $null",
    "if ($RequestedVoice) {",
    "  $selectedVoice = $voices | Where-Object { $_.Name -eq $RequestedVoice } | Select-Object -First 1",
    "}",
    "if (-not $selectedVoice -and $PreferredCulturePrefix) {",
    "  $selectedVoice = $voices | Where-Object {",
    "    $_.Culture.Name.StartsWith($PreferredCulturePrefix, [System.StringComparison]::OrdinalIgnoreCase) -and",
    "    ($PreferredGender -eq '' -or $_.Gender.ToString().ToLowerInvariant() -eq $PreferredGender)",
    "  } | Select-Object -First 1",
    "}",
    "if (-not $selectedVoice -and $PreferredCulturePrefix) {",
    "  $selectedVoice = $voices | Where-Object {",
    "    $_.Culture.Name.StartsWith($PreferredCulturePrefix, [System.StringComparison]::OrdinalIgnoreCase)",
    "  } | Select-Object -First 1",
    "}",
    "if (-not $selectedVoice -and -not $allowAnyVoice) {",
    "  $available = @($voices | ForEach-Object { '{0} [{1}, {2}]' -f $_.Name, $_.Culture.Name, $_.Gender }) -join '; '",
    "  throw ('Voice lokal Windows untuk Bahasa Indonesia tidak tersedia. Voice terpasang: ' + $available)",
    "}",
    "if (-not $selectedVoice -and $PreferredGender) {",
    "  $selectedVoice = $voices | Where-Object { $_.Gender.ToString().ToLowerInvariant() -eq $PreferredGender } | Select-Object -First 1",
    "}",
    "if (-not $selectedVoice) {",
    "  $selectedVoice = $voices | Select-Object -First 1",
    "}",
    "if ($selectedVoice) {",
    "  $synth.SelectVoice($selectedVoice.Name)",
    "}",
    "$synth.Rate = $RateValue",
    "$synth.SetOutputToWaveFile($OutputPath)",
    "$synth.Speak($text)",
    "$synth.Dispose()"
  ].join("\n");
  await writeFile(scriptPath, script, "utf8");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        input.allowAnyVoice ? "1" : "0",
        input.textPath,
        input.outputPath,
        input.preferredCulturePrefix,
        input.preferredGender || "",
        String(input.rate),
        input.voiceName
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Windows TTS gagal dijalankan${stderr.trim() ? `: ${stderr.trim()}` : ` (exit ${code})`}.`
        )
      );
    });
  });
}

export class WindowsTtsService implements SpeechGenerator {
  public constructor(
    private readonly logger: FastifyBaseLogger,
    private readonly runPowerShell: PowerShellRunner = runPowerShellTts,
    private readonly platformName: NodeJS.Platform = process.platform
  ) {}

  public async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<{ data: Buffer; mimeType: string }> {
    if (this.platformName !== "win32") {
      throw new Error("Windows local TTS hanya tersedia di Windows.");
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), "affiliate-local-tts-"));
    const textPath = path.join(tempDir, "input.txt");
    const outputPath = path.join(tempDir, "output.wav");
    const preferredVoice = findTtsVoiceByName(input.voiceName);

    try {
      await writeFile(textPath, input.text, "utf8");
      await this.runPowerShell({
        allowAnyVoice: false,
        textPath,
        outputPath,
        preferredCulturePrefix: "id",
        preferredGender: preferredVoice?.gender,
        rate: clampRate(input.speechRate),
        voiceName: input.voiceName
      });

      const data = await readFile(outputPath);
      this.logger.warn(
        {
          requestedVoiceName: input.voiceName,
          preferredGender: preferredVoice?.gender,
          outputPath
        },
        "Voice-over dibuat dengan Windows local TTS fallback."
      );
      return {
        data,
        mimeType: "audio/wav"
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
