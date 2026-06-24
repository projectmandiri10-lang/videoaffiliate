import type { ClipCandidateDraft, DeviceMode, LocalArtifactRef } from "@app/core";

export interface AnalyzeVideoResult {
  durationSec: number;
  candidates: ClipCandidateDraft[];
}

export interface PreviewClipRequest {
  clipId: string;
  startSec: number;
  durationSec: number;
}

export interface PreviewClipResult {
  clipId: string;
  blob: Blob;
}

export interface RenderFinalRequest {
  sourceVideo: Uint8Array;
  sourceFileName: string;
  startSec: number;
  durationSec: number;
  audioBytes: Uint8Array;
  audioMimeType: string;
  subtitleText: string;
  deviceMode: DeviceMode;
}

export interface RenderFinalResult {
  blob: Blob;
}

export interface ExtractClipFramesResult {
  frames: Array<{
    dataUrl: string;
    timestampSec: number;
  }>;
}

type WorkerRequestMap = {
  analyzeVideo: {
    sourceVideo: Uint8Array;
    sourceFileName: string;
    deviceMode: DeviceMode;
  };
  buildPreviews: {
    sourceVideo: Uint8Array;
    sourceFileName: string;
    clips: PreviewClipRequest[];
    deviceMode: DeviceMode;
  };
  renderFinal: RenderFinalRequest;
  extractClipFrames: {
    sourceVideo: Uint8Array;
    sourceFileName: string;
    startSec: number;
    durationSec: number;
  };
};

type WorkerResponseMap = {
  analyzeVideo: AnalyzeVideoResult;
  buildPreviews: PreviewClipResult[];
  renderFinal: RenderFinalResult;
  extractClipFrames: Array<{
    dataUrl: string;
    timestampSec: number;
  }>;
};

interface WorkerSuccessMessage<T extends keyof WorkerRequestMap> {
  requestId: string;
  type: "result";
  command: T;
  payload: WorkerResponseMap[T];
}

interface WorkerErrorMessage {
  requestId: string;
  type: "error";
  message: string;
}

interface WorkerLogMessage {
  type: "log";
  message: string;
}

interface WorkerProgressMessage {
  type: "progress";
  progress: number;
}

type WorkerInboundMessage =
  | WorkerLogMessage
  | WorkerProgressMessage
  | WorkerErrorMessage
  | WorkerSuccessMessage<keyof WorkerRequestMap>;

type WorkerListener = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class RenderWorkerClient {
  private worker: Worker | null = null;

  private readonly pending = new Map<string, WorkerListener>();

  private readonly progressListeners = new Set<(progress: number) => void>();

  private readonly logListeners = new Set<(message: string) => void>();

  public constructor() {
    // Worker initialization is lazy so unit tests can import the runtime without a browser Worker.
  }

  public onProgress(listener: (progress: number) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  public onLog(listener: (message: string) => void): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  public async analyzeVideo(
    input: WorkerRequestMap["analyzeVideo"]
  ): Promise<AnalyzeVideoResult> {
    return this.send("analyzeVideo", input);
  }

  public async buildPreviews(
    input: WorkerRequestMap["buildPreviews"]
  ): Promise<PreviewClipResult[]> {
    return this.send("buildPreviews", input);
  }

  public async renderFinal(input: WorkerRequestMap["renderFinal"]): Promise<RenderFinalResult> {
    return this.send("renderFinal", input);
  }

  public async extractClipFrames(
    input: WorkerRequestMap["extractClipFrames"]
  ): Promise<WorkerResponseMap["extractClipFrames"]> {
    return this.send("extractClipFrames", input);
  }

  private async send<T extends keyof WorkerRequestMap>(
    command: T,
    payload: WorkerRequestMap[T]
  ): Promise<WorkerResponseMap[T]> {
    const requestId = randomId();
    const transferables: Transferable[] = [];

    if ("sourceVideo" in payload && payload.sourceVideo instanceof Uint8Array) {
      transferables.push(payload.sourceVideo.buffer);
    }
    if ("audioBytes" in payload && payload.audioBytes instanceof Uint8Array) {
      transferables.push(payload.audioBytes.buffer);
    }

    const response = new Promise<WorkerResponseMap[T]>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });

    const worker = this.getWorker();
    worker.postMessage(
      {
        requestId,
        command,
        payload
      },
      transferables
    );
    return response;
  }

  private getWorker(): Worker {
    if (!this.worker) {
      if (typeof Worker === "undefined") {
        throw new Error("Browser Worker tidak tersedia di environment ini.");
      }
      this.worker = new Worker(new URL("../workers/render.worker.ts", import.meta.url), {
        type: "module"
      });
      this.worker.addEventListener("message", (event: MessageEvent<WorkerInboundMessage>) => {
        const message = event.data;
        if (message.type === "log") {
          for (const listener of this.logListeners) {
            listener(message.message);
          }
          return;
        }
        if (message.type === "progress") {
          for (const listener of this.progressListeners) {
            listener(message.progress);
          }
          return;
        }
        const pending = this.pending.get(message.requestId);
        if (!pending) {
          return;
        }
        this.pending.delete(message.requestId);
        if (message.type === "error") {
          pending.reject(new Error(message.message));
          return;
        }
        pending.resolve(message.payload);
      });
    }
    return this.worker;
  }
}
