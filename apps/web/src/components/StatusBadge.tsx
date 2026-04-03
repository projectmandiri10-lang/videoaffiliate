import type { JobOverallStatus, PlatformStatus } from "../types";

const palette: Record<JobOverallStatus | PlatformStatus, string> = {
  queued: "status status-queued",
  running: "status status-running",
  success: "status status-success",
  partial_success: "status status-partial",
  failed: "status status-failed",
  interrupted: "status status-interrupted",
  pending: "status status-queued",
  done: "status status-success"
};

export function StatusBadge({ status }: { status: JobOverallStatus | PlatformStatus }) {
  return <span className={palette[status] || "status"}>{status}</span>;
}
