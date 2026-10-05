/**
 * A module-level registry that allows ImageObjectWrapper to look up
 * upload state (progress, retry, uploader) without prop-drilling from the hook.
 *
 * `useImageInsert` registers/updates entries during the upload lifecycle.
 */

export interface UploadEntry {
  uploaderId: string;
  progress: number;
  canRetry: boolean;
  retryFn(): void;
}

const entries = new Map<string, UploadEntry>();

export function setUploadEntry(objectId: string, entry: UploadEntry): void {
  entries.set(objectId, entry);
}

export function getUploadEntry(objectId: string): UploadEntry | undefined {
  return entries.get(objectId);
}

export function removeUploadEntry(objectId: string): void {
  entries.delete(objectId);
}
