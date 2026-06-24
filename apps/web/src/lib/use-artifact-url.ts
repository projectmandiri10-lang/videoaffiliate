import { useEffect, useState } from "react";
import type { LocalArtifactRef } from "../types";
import { toArtifactObjectUrl } from "../api";

export function useArtifactUrl(artifact?: LocalArtifactRef) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!artifact) {
      setUrl(undefined);
      return;
    }
    void toArtifactObjectUrl(artifact).then((nextUrl) => {
      if (active) {
        setUrl(nextUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [artifact?.artifactId]);

  return url;
}
