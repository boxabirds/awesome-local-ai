/**
 * In-flight upload bookkeeping (story 12, image.insert / image.upload_failure).
 *
 * Progress and the "can this be retried?" answer live in a module store rather
 * than React state because two very different places need them: the insert hook
 * (which starts uploads) and each `ImageObject` (which renders a percentage, or
 * a Retry button) — and object components are rendered by the generic registry
 * with a fixed prop list.
 *
 * The store also keeps the `File` of every upload started in this page session,
 * which is what makes Retry possible. After a reload the files are gone, so the
 * failed placeholder only offers Remove (PRD image.upload_failure).
 */
import type * as Y from 'yjs';
import {
  markImageFailed,
  markImageReady,
  markImageRetrying,
} from '../../shared/objects/image';
import { REJECTION_MESSAGES } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import { showToast } from '../ui/Toast';

interface QueueEntry {
  file: File;
  fraction: number;
  uploading: boolean;
  handle: UploadHandle | null;
}

const entries = new Map<string, QueueEntry>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Subscribe to any change in progress or retry availability. */
export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Cheap monotonic value to use with `useSyncExternalStore`. */
export function uploadVersion(): number {
  return version;
}

export function isUploading(id: string): boolean {
  const entry = entries.get(id);
  return entry !== undefined && entry.uploading;
}

/** Upload fraction (0..1) for this page's own uploads, or null when unknown. */
export function progressOf(id: string): number | null {
  const entry = entries.get(id);
  if (!entry || !entry.uploading) return null;
  return entry.fraction;
}

/** Retry is only possible while the original file is still in memory. */
export function canRetryImage(id: string): boolean {
  const entry = entries.get(id);
  return entry !== undefined && !entry.uploading;
}

/** Progress map for the insert hook's callers (uploader's own view only). */
export function progressSnapshot(): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [id, entry] of entries) {
    if (entry.uploading) map.set(id, entry.fraction);
  }
  return map;
}

/**
 * Write an outcome into the doc. A response can land after the board has been
 * unmounted and its doc destroyed, which must never surface as an error.
 */
function writeOutcome(mutate: () => void): void {
  try {
    mutate();
  } catch {
    // The doc is gone; the placeholder is somebody else's problem now.
  }
}

function runUpload(doc: Y.Doc, boardId: string, id: string, file: File): void {
  const entry: QueueEntry = { file, fraction: 0, uploading: true, handle: null };
  entries.set(id, entry);
  emit();

  const handle = uploadImage(boardId, file, (fraction) => {
    if (!entries.has(id)) return;
    entry.fraction = fraction;
    emit();
  });
  entry.handle = handle;

  void handle.promise.then((result) => {
    // The object may have been deleted (or undone) while the bytes were in
    // flight; in that case the result is simply dropped.
    if (!entries.has(id)) return;
    entry.uploading = false;
    entry.handle = null;

    switch (result.kind) {
      case 'ok':
        writeOutcome(() => markImageReady(doc, id, result.assetKey));
        // The file is no longer needed once the bytes are safely stored.
        entries.delete(id);
        break;
      case 'rate_limited':
        writeOutcome(() => markImageFailed(doc, id));
        showToast(REJECTION_MESSAGES.rate);
        break;
      case 'aborted':
        // A cancelled upload says nothing about the file: leave the object as it
        // was so a later retry (or the stale timer) explains it.
        entries.delete(id);
        break;
      default:
        writeOutcome(() => markImageFailed(doc, id));
        break;
    }
    emit();
  });
}

/**
 * Upload the file for a freshly created placeholder. Fire and forget: the outcome
 * is written into the doc, which is what every participant renders from.
 */
export function startUpload(args: {
  doc: Y.Doc;
  boardId: string;
  id: string;
  file: File;
}): void {
  runUpload(args.doc, args.boardId, args.id, args.file);
}

/**
 * Try the same file again. Returns false when the file is no longer in memory
 * (after a reload), in which case the caller leaves the object alone.
 */
export function retryUpload(doc: Y.Doc, boardId: string, id: string, now = Date.now()): boolean {
  const entry = entries.get(id);
  if (!entry || entry.uploading) return false;
  if (!markImageRetrying(doc, id, now)) {
    entries.delete(id);
    emit();
    return false;
  }
  runUpload(doc, boardId, id, entry.file);
  return true;
}

/** Drop bookkeeping for objects that are gone from the board. */
export function forgetImages(ids: readonly string[]): void {
  let changed = false;
  for (const id of ids) {
    const entry = entries.get(id);
    if (entry) {
      entry.handle?.abort();
      entries.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

/** Cancel everything still in flight (used when the board unmounts). */
export function abortAllUploads(): void {
  forgetImages([...entries.keys()]);
}

/** Test helper: forget everything without touching the doc. */
export function resetUploadQueue(): void {
  for (const entry of entries.values()) entry.handle?.abort();
  entries.clear();
  emit();
}
