import type { LocalArtifactRef } from "@app/core";
import { dbDelete, dbGet, dbSet } from "./browser-db";
import { nowIso } from "./time";

const ARTIFACT_LIST_KEY = "artifact-list";

type StoredArtifactIndex = Record<string, LocalArtifactRef>;

const objectUrlCache = new Map<string, string>();

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readArtifactIndex(): Promise<StoredArtifactIndex> {
  return (await dbGet<StoredArtifactIndex>("artifacts", ARTIFACT_LIST_KEY)) ?? {};
}

async function writeArtifactIndex(index: StoredArtifactIndex): Promise<void> {
  await dbSet("artifacts", ARTIFACT_LIST_KEY, index);
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    return null;
  }
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function putBlobInOpfs(artifactId: string, blob: Blob): Promise<boolean> {
  const root = await getOpfsRoot();
  if (!root) {
    return false;
  }
  const handle = await root.getFileHandle(artifactId, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

async function getBlobFromOpfs(artifactId: string): Promise<Blob | null> {
  const root = await getOpfsRoot();
  if (!root) {
    return null;
  }
  try {
    const handle = await root.getFileHandle(artifactId);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function deleteBlobFromOpfs(artifactId: string): Promise<void> {
  const root = await getOpfsRoot();
  if (!root) {
    return;
  }
  try {
    await root.removeEntry(artifactId);
  } catch {
    // Ignore missing file cleanup.
  }
}

export async function putArtifact(input: {
  blob: Blob;
  fileName: string;
  mimeType?: string;
}): Promise<LocalArtifactRef> {
  const artifactId = randomId();
  const storedInOpfs = await putBlobInOpfs(artifactId, input.blob);
  if (!storedInOpfs) {
    await dbSet("artifactBlobs", artifactId, input.blob);
  }

  const ref: LocalArtifactRef = {
    artifactId,
    fileName: input.fileName,
    mimeType: input.mimeType || input.blob.type || "application/octet-stream",
    size: input.blob.size,
    storage: storedInOpfs ? "opfs" : "idb",
    createdAt: nowIso()
  };

  const index = await readArtifactIndex();
  index[artifactId] = ref;
  await writeArtifactIndex(index);
  return ref;
}

export async function getArtifactBlob(ref: LocalArtifactRef): Promise<Blob> {
  if (ref.storage === "opfs") {
    const blob = await getBlobFromOpfs(ref.artifactId);
    if (blob) {
      return blob;
    }
  }

  const blob = await dbGet<Blob>("artifactBlobs", ref.artifactId);
  if (!blob) {
    throw new Error(`Artifact ${ref.fileName} tidak ditemukan di browser storage.`);
  }
  return blob;
}

export async function deleteArtifact(ref?: LocalArtifactRef): Promise<void> {
  if (!ref) {
    return;
  }
  if (ref.storage === "opfs") {
    await deleteBlobFromOpfs(ref.artifactId);
  }
  await dbDelete("artifactBlobs", ref.artifactId);
  const index = await readArtifactIndex();
  delete index[ref.artifactId];
  await writeArtifactIndex(index);
  const cachedUrl = objectUrlCache.get(ref.artifactId);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    objectUrlCache.delete(ref.artifactId);
  }
}

export async function getArtifactObjectUrl(ref?: LocalArtifactRef): Promise<string | undefined> {
  if (!ref) {
    return undefined;
  }
  const cachedUrl = objectUrlCache.get(ref.artifactId);
  if (cachedUrl) {
    return cachedUrl;
  }
  const blob = await getArtifactBlob(ref);
  const objectUrl = URL.createObjectURL(blob);
  objectUrlCache.set(ref.artifactId, objectUrl);
  return objectUrl;
}

export async function downloadArtifact(ref?: LocalArtifactRef): Promise<void> {
  if (!ref) {
    return;
  }
  const blob = await getArtifactBlob(ref);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ref.fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareArtifact(ref?: LocalArtifactRef): Promise<boolean> {
  if (!ref || typeof navigator === "undefined" || !navigator.share) {
    return false;
  }
  const blob = await getArtifactBlob(ref);
  const file = new File([blob], ref.fileName, { type: ref.mimeType });
  const canShareFiles = typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : false;
  if (!canShareFiles) {
    return false;
  }
  await navigator.share({
    title: ref.fileName,
    files: [file]
  });
  return true;
}
