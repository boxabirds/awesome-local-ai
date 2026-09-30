/**
 * useImageInsert: drop/paste/picker image insertion (story 12).
 *
 * Validates files, computes layout, creates Y.Doc placeholders, uploads with
 * byte-progress, and updates status.
 */

import { useCallback, useRef, useState } from 'react';

import { validateFiles, REJECTION_MESSAGES, type FileRejection } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
} from '../../shared/objects/image';

export interface Point {
  x: number;
  y: number;
}

export interface ImageInsertDeps {
  boardId: string;
  getDoc: () => import('yjs').Doc | null;
  undoBoundary: (label: string, fn: () => void) => void;
  toast: (message: string) => void;
  screenToWorld: (screen: Point) => Point;
  isOnline: () => boolean;
  clientId: () => string;
}

interface ImageFile {
  file: File;
  naturalWidth: number;
  naturalHeight: number;
  bytes: ArrayBuffer;
}

/**
 * Returns `insertImages`, `retry`, `canRetry`, and a progress map.
 * Call insertImages with the files and the world-space point where the first
 * image goes (anchor 'top-left' for drop, 'centre' for paste/picker).
 */
export function useImageInsert(deps: ImageInsertDeps) {
  // In-memory store of file bytes keyed by object id (lost on reload by design)
  const bytesStore = useRef<Map<string, ArrayBuffer>>(new Map());

  // Progress map: id -> 0..100 percent. Kept in React state so ImageObject re-renders.
  const [progressMap, setProgressMap] = useState<ReadonlyMap<string, number>>(new Map());

  const setProgress = useCallback((id: string, percent: number) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.set(id, percent);
      return next;
    });
  }, []);

  const clearProgress = useCallback((id: string) => {
    setProgressMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const uploadAndSetStatus = useCallback(async (id: string, bytes: ArrayBuffer) => {
    const doc = deps.getDoc();
    if (!doc) return;
    try {
      const result = await uploadImage(
        deps.boardId,
        bytes,
        (loaded, total) => {
          if (total > 0) setProgress(id, (loaded / total) * 100);
        },
      );
      markImageReady(doc, id, result.assetKey);
    } catch (err) {
      if (err instanceof Error && err.message === 'offline') {
        markImageFailed(doc, id);
        deps.toast(REJECTION_MESSAGES.offline);
      } else {
        markImageFailed(doc, id);
      }
    } finally {
      clearProgress(id);
    }
  }, [deps, setProgress, clearProgress]);

  const retry = useCallback(async (id: string): Promise<boolean> => {
    const bytes = bytesStore.current.get(id);
    if (!bytes) return false;
    const doc = deps.getDoc();
    if (!doc) return false;
    markImageRetrying(doc, id, Date.now());
    await uploadAndSetStatus(id, bytes);
    return true;
  }, [deps, uploadAndSetStatus]);

  const canRetry = useCallback((id: string): boolean => {
    return bytesStore.current.has(id);
  }, []);

  const insertImages = useCallback(async (
    files: readonly File[],
    worldPoint: Point,
    anchor: 'top-left' | 'centre',
  ) => {
    // Online check
    if (!deps.isOnline()) {
      deps.toast(REJECTION_MESSAGES.offline);
      return;
    }

    // Validate files client-side
    const { accepted, rejections } = validateFiles(files);

    // Show rejection messages for each unique rejection reason
    if (rejections.size > 0) {
      for (const r of rejections) {
        deps.toast(REJECTION_MESSAGES[r as FileRejection | 'offline']);
      }
    }

    if (accepted.length === 0) return;

    // Read files and get dimensions
    const imageFiles: ImageFile[] = [];
    let decodeFailed = false;
    for (const file of accepted) {
      try {
        const bytes = await file.arrayBuffer();
        const dims = await getImageDims(bytes);
        imageFiles.push({ file, naturalWidth: dims.width, naturalHeight: dims.height, bytes });
      } catch {
        // Decode failure treated as an unsupported/invalid type.
        decodeFailed = true;
      }
    }

    if (decodeFailed) {
      deps.toast(REJECTION_MESSAGES.type);
    }

    if (imageFiles.length === 0) return;

    // Compute placement sizes and layout
    const sizes = imageFiles.map((img) => placementSize(img.naturalWidth, img.naturalHeight));
    const rects = layoutRow(sizes, worldPoint, anchor);

    // Create placeholders in one undo step
    const doc = deps.getDoc();
    if (!doc) return;

    let ids: string[] = [];
    deps.undoBoundary('Add image', () => {
      ids = createImagePlaceholders(
        doc,
        imageFiles.map((img, i) => ({
          rect: rects[i]!,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          contentType: img.file.type,
        })),
        deps.clientId(),
        Date.now(),
      );
    });

    // Upload each image in parallel (outside the undo step).
    const uploads = ids.map((id, i) => {
      const bytes = imageFiles[i]!.bytes;
      bytesStore.current.set(id, bytes);
      return uploadAndSetStatus(id, bytes);
    });
    await Promise.all(uploads);
  }, [deps, uploadAndSetStatus]);

  return { insertImages, retry, canRetry, progress: progressMap };
}

/**
 * Decode image bytes to get natural dimensions.
 */
async function getImageDims(bytes: ArrayBuffer): Promise<{ width: number; height: number }> {
  // Use createImageBitmap for decoding
  const blob = new Blob([bytes]);
  const bitmap = await createImageBitmap(blob);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}
