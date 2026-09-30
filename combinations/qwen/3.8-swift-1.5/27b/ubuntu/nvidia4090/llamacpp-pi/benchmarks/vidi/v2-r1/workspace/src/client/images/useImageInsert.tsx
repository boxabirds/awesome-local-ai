/**
 * Story 12: image insertion controller (image.insert).
 *
 * One hook owns the whole insert pipeline for all entry points (drop,
 * paste, picker, upload): validate → decode → placeholders (one undo step)
 * → upload → ready/failed. Toasts are pushed through `onToast`.
 *
 * - Progress is tracked per placeholder id via XHR (fetch has no progress);
 *   100% is set when the ready status lands.
 * - Failed uploads keep the placeholder (`status: 'failed'`) and the File,
 *   so `retryImage` re-enters the upload flow (PRD image.upload_failure).
 * - The hidden file input serves the picker; picking files adds them at the
 *   point the picker was opened (viewport centre) and the picker flag
 *   clears.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Point } from '@shared/geometry';
import {
  createImagePlaceholders, layoutRow, placementSize,
  markImageFailed, markImageReady, markImageRetrying,
} from '@shared/objects/image';
import { validateFiles, REJECTION_MESSAGES, type FileRejection } from './validateFiles';
import { decodeImage, uploadImageWithProgress, type DecodedImage, type UploadFn } from './uploadImage';

export interface UseImageInsertParams {
  doc: Y.Doc;
  boardId: string;
  /** Called for every user-facing toast message (exact PRD wording). */
  onToast: (message: string) => void;
  /**
   * Upload function (injectable for tests). Returns the assetKey.
   * Defaults to the XHR/fetch implementation with progress.
   */
  uploadFn?: UploadFn;
  /** Decode function (injectable for tests). Defaults to decodeImage. */
  decodeFn?: (file: File) => Promise<DecodedImage>;
}

export interface UseImageInsertResult {
  /** Validate + insert files with the row's top-left at `worldPoint`. */
  addFilesAt: (files: File[], worldPoint: Point) => void;
  /** Open the native file picker; picked files are added at `worldPoint`. */
  openPicker: (worldPoint: Point) => void;
  /** Re-upload a failed image (its File is kept client-side). */
  retryImage: (id: string) => void;
  /** Upload progress 0..1 per placeholder id. */
  progress: Record<string, number>;
  /** Placeholder ids whose upload failed (retry button visible). */
  failedIds: ReadonlySet<string>;
  /** True while the native picker is open (drop highlight variant). */
  pickerOpen: boolean;
  /** Render the hidden file input (mount it once inside Board). */
  renderInput: () => React.ReactElement;
}

export function useImageInsert({
  doc, boardId, onToast,
  uploadFn = uploadImageWithProgress,
  decodeFn = decodeImage,
}: UseImageInsertParams): UseImageInsertResult {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickerPointRef = useRef<Point>({ x: 0, y: 0 });
  // Failed uploads keep their File for retry.
  const failedFilesRef = useRef<Map<string, File>>(new Map());
  // One "couldn't upload" toast per add action, not per file.
  const toastShownForActionRef = useRef<Set<string>>(new Set());

  const setProgressFor = useCallback((id: string, value: number) => {
    setProgress((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      setProgressFor(id, 0);
      const finishOk = (assetKey: string) => {
        markImageReady(doc, id, assetKey); // UPLOAD_ORIGIN inside
        setProgressFor(id, 1);
        failedFilesRef.current.delete(id);
      };
      const finishFail = () => {
        markImageFailed(doc, id); // UPLOAD_ORIGIN inside
        failedFilesRef.current.set(id, file);
        setFailedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        if (!toastShownForActionRef.current.has(id)) {
          toastShownForActionRef.current.add(id);
          onToast('Some images couldn\'t be uploaded.');
        }
      };
      uploadFn(boardId, file, (p) => setProgressFor(id, p))
        .then(finishOk)
        .catch(() => finishFail());
    },
    [boardId, doc, onToast, setProgressFor, uploadFn],
  );

  const addFilesAt = useCallback(
    (files: File[], worldPoint: Point) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        onToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections) {
        onToast(REJECTION_MESSAGES[reason as FileRejection]);
      }
      if (accepted.length === 0) return;

      // Decode everything first: a file that cannot be decoded is not a
      // usable image (same 'type' message).
      Promise.all(
        accepted.map(async (file) => {
          try {
            const decoded = await decodeFn(file);
            return { file, decoded };
          } catch {
            return { file, decoded: null };
          }
        }),
      ).then((results) => {
        const ok = results.filter((r): r is { file: File; decoded: NonNullable<typeof r.decoded> } => r.decoded !== null);
        if (results.length > ok.length) {
          onToast(REJECTION_MESSAGES.type);
        }
        if (ok.length === 0) return;

        const sizes = ok.map(({ decoded }) => placementSize(decoded.width, decoded.height));
        const rects = layoutRow(sizes, worldPoint, 'top-left');
        const items = ok.map(({ decoded }, i) => ({
          rect: rects[i],
          naturalWidth: decoded.width,
          naturalHeight: decoded.height,
          contentType: decoded.contentType,
        }));
        // One transaction → one undo step for the whole action.
        const ids = createImagePlaceholders(doc, items, uploaderIdOf(doc), Date.now());
        ids.forEach((id, i) => startUpload(id, ok[i].file));
      });
    },
    [doc, onToast, startUpload, decodeFn],
  );

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).filter((f) => f.type.startsWith('image/'));
      event.target.value = '';
      setPickerOpen(false);
      if (files.length > 0) {
        addFilesAt(files, pickerPointRef.current);
      }
    },
    [addFilesAt],
  );

  const openPicker = useCallback(
    (worldPoint: Point) => {
      pickerPointRef.current = worldPoint;
      setPickerOpen(true);
      // Native picker is modal; open after the flag renders.
      requestAnimationFrame(() => inputRef.current?.click());
    },
    [],
  );

  const retryImage = useCallback(
    (id: string) => {
      const file = failedFilesRef.current.get(id);
      if (!file) return;
      markImageRetrying(doc, id, Date.now());
      setFailedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toastShownForActionRef.current.delete(id);
      startUpload(id, file);
    },
    [doc, startUpload],
  );

  // Clean up progress entries for objects that no longer exist (deleted
  // placeholders), so the map does not grow unbounded.
  useEffect(() => {
    const objects = doc.getMap('objects');
    const prune = () => {
      setProgress((prev) => {
        const ids = Object.keys(prev);
        if (ids.length === 0) return prev;
        const alive = ids.filter((id) => objects.has(id));
        if (alive.length === ids.length) return prev;
        const next: Record<string, number> = {};
        for (const id of alive) next[id] = prev[id];
        return next;
      });
    };
    objects.observe(prune);
    return () => objects.unobserve(prune);
  }, [doc]);

  const renderInput = useCallback(
    () => (
      <input
        ref={inputRef}
        type="file"
        data-testid="image-file-input"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={onInputChange}
      />
    ),
    [onInputChange],
  );

  return { addFilesAt, openPicker, retryImage, progress, failedIds, pickerOpen, renderInput };
}

/** The uploader is identified by the Yjs client id of the local peer. */
function uploaderIdOf(doc: Y.Doc): string {
  return String(doc.clientID);
}
