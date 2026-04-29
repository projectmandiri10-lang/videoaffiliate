export type JobCreationPhase = "uploading" | "created" | "failed";

export interface JobCreationTransition {
  requestId: number;
  title: string;
  phase: JobCreationPhase;
  jobId?: string;
  status?: string;
  error?: string;
}
