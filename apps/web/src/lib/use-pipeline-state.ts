import { useSyncExternalStore } from "react";
import { pipelineRuntime } from "./pipeline-runtime";

export function usePipelineState() {
  return useSyncExternalStore(
    (listener) => pipelineRuntime.subscribe(() => listener()),
    () => pipelineRuntime.getSnapshot(),
    () => pipelineRuntime.getSnapshot()
  );
}
