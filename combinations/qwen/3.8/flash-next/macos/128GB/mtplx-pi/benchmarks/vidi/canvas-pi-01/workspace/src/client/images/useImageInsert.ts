/**
 * Story 12 · tasks 5 & 7 — the image insertion controller.
 *
 * This is where the three ways in (drag-and-drop, Ctrl+V, the Image picker) and
 * Retry all meet one implementation of *read → place → upload*, because all
 * three do exactly that and the shared work belongs here, not at each call site
 * (design "Decision on code ownership").
 *
 * The flow for one batch (PRD image.drop, image.place, image.upload):
 *
 *  1. validate the files' *name and size* first (`validateFiles`) — that is fast
 *     and needs no decode;
 *  2. decode each survivor to its natural pixels, then compute its placed size
 *     and lay the row out (top-left for a drop, centred for paste / picker);
 *  3. write every placeholder in ONE undo step (the model does that in one
 *     `LOCAL_ORIGIN` transaction);
 *  4. start each file's upload, and write `ready` / `failed` under the untracked
 *     upload origin as each settles.
 *
 * Everything user-triggered is gated on `canEdit`: a read-only board, an offline
 * board whose connection has dropped, and a board that failed to load all answer
 * nothing here but their reason (PRD interaction). A file that cannot be decoded
 * (an SVG a browser refuses to draw, a corrupt PNG) is *not* placed — there is no
 * preview to fall back to, so "unsupported" is the honest message.
 *
 * The two browser effects — decoding and uploading — are injectable (`decode`,
 * `upload`) so the whole orchestration is testable in jsdom with no network and
 * no real R2, exactly as the pen's stroke model was tested in Node.
 */
import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import type { AssetResult } from '../../shared/assets-protocol';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';

/** The result of reading one accepted file: its natural pixels. */
export interface DecodedImage {
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Read a file's natural pixels. Default tries `createImageBitmap` (the design's
 * choice) and falls back to an `<img>` `onload` when that is unavailable, since
 * `jsdom` provides neither but a test can supply one. Returns `null` when the
 * bytes are not a decodable image (the corrupt-PNG and SVG cases).
 */
export async function defaultDecode(file: File): Promise<DecodedImage | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const size = { naturalWidth: bitmap.width, naturalHeight: bitmap.height };
      bitmap.close?.();
      return size;
    }
  } catch {
    return null;
  }
  if (typeof Image === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<DecodedImage | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve(
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
              : null,
          );
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL?.(url);
    }
  }
  return null;
}

export interface ImageInsertDeps {
  getDoc(): Y.Doc;
  getIdentityId(): string;
  /** The URL to POST an upload to for the current board. */
  uploadUrl(): string;
  /** Whether the board currently accepts a write (PRD interaction). */
  canEdit(): boolean;
  /** Show a one-line toast; the parent owns the ~3s timer. */
  toast(message: string, tone?: 'info' | 'warning'): void;
  /** A clock, so a test can pin the unfinished boundary. */
  now(): number;
  /** Injectable upload (default {@link uploadImage}), for tests. */
  upload?(
    url: string,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<AssetResult>;
  /** Injectable decode (default {@link defaultDecode}), for tests. */
  decode?(file: File): Promise<DecodedImage | null>;
}

/** One live upload, keyed by the object id it belongs to. */
interface UploadRecord {
  file: File;
  /** Whether this client owns the upload (only it may Retry). */
  mine: boolean;
}

export interface ImageInsertState {
  /** Live upload progress per object id (for the placeholder indicator). */
  progress: Readonly<Record<string, number>>;
  /**
   * Insert a batch. `point` is a drop target in *screen* pixels, or `null` for a
   * centre placement (paste / picker). Returns the placeholders created (may be
   * fewer than the input, or empty if all were refused).
   */
  insert(
    files: readonly File[],
    point: { x: number; y: number } | null,
    screenToWorld: (point: { x: number; y: number }) => { x: number; y: number },
    viewportCentre: { x: number; y: number },
  ): Promise<string[]>;
  /** Retry a failed image (only for the uploader's own). */
  retry(objectId: string): Promise<void>;
  /** Per-id progress, for the render layer. */
  getProgress(id: string): number;
}

/** One file that survived validation and decoding, ready to place and upload. */
interface PreparedImage {
  file: File;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  contentType: string;
}

/**
 * Hold the per-board upload state and expose `insert` / `retry`, so the live
 * upload table lives with the board (not a module singleton) and two boards — or
 * a reload — never share an upload.
 */
export function useImageInsert(deps: ImageInsertDeps): ImageInsertState {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const uploadsRef = useRef<Map<string, UploadRecord>>(new Map());

  const setOneProgress = useCallback((id: string, value: number) => {
    setProgress((prev) => ({ ...prev, [id]: value }));
  }, []);

  const startUpload = useCallback(
    async (id: string, file: File): Promise<void> => {
      const doc = deps.getDoc();
      const upload = deps.upload ?? ((url, f, onProgress) => uploadImage(url, f, onProgress));
      setOneProgress(id, 0.02);
      const result = await upload(deps.uploadUrl(), file, (fraction) => {
        setOneProgress(id, Math.max(0.02, Math.min(0.99, fraction)));
      });
      if (result.ok) {
        markImageReady(doc, id, result.assetKey);
        setOneProgress(id, 1);
      } else {
        markImageFailed(doc, id);
        const record = uploadsRef.current.get(id);
        if (record !== undefined) record.mine = false;
      }
    },
    [deps, setOneProgress],
  );

  const insert = useCallback(
    async (
      files: readonly File[],
      point: { x: number; y: number } | null,
      screenToWorld: (point: { x: number; y: number }) => { x: number; y: number },
      viewportCentre: { x: number; y: number },
    ): Promise<string[]> => {
      if (files.length === 0) return [];
      if (!deps.canEdit()) {
        // A read-only / offline / load-failed board answers with its reason only.
        deps.toast(REJECTION_MESSAGES.offline, 'warning');
        return [];
      }

      // 1. name + size validation.
      const { accepted, rejections } = validateFiles(Array.from(files));
      if (rejections.size > 0) {
        const reason = rejections.has('count') ? 'count' : rejections.has('type') ? 'type' : 'size';
        deps.toast(REJECTION_MESSAGES[reason], 'warning');
      }
      if (accepted.length === 0) return [];

      // 2. decode each survivor; refuse anything undecodable (no preview to keep).
      const decode = deps.decode ?? defaultDecode;
      const prepared: PreparedImage[] = [];
      let undecodable = 0;
      for (const file of accepted) {
        const size = await decode(file);
        if (size === null || size.naturalWidth <= 0 || size.naturalHeight <= 0) {
          undecodable += 1;
          continue;
        }
        const placed = placementSize(size.naturalWidth, size.naturalHeight);
        prepared.push({
          file,
          width: placed.width,
          height: placed.height,
          naturalWidth: size.naturalWidth,
          naturalHeight: size.naturalHeight,
          contentType: file.type || 'image/png',
        });
      }
      // An unsupported-but-right-extension file (corrupt / SVG) still earns the
      // type message, even if the batch also had a valid file.
      if (undecodable > 0 && !rejections.has('type')) {
        deps.toast(REJECTION_MESSAGES.type, 'warning');
      }
      if (prepared.length === 0) return [];

      const doc = deps.getDoc();
      const now = deps.now();

      // Place them: a drop anchors the first image's top-left at the cursor; a
      // paste / picker centres the whole row on the viewport centre.
      const anchor = point === null ? 'centre' : 'top-left';
      const worldStart = screenToWorld(point ?? viewportCentre);
      const rects = layoutRow(
        prepared.map((item) => ({ width: item.width, height: item.height })),
        worldStart,
        anchor,
      );

      // 3. one undo step for the whole batch (the model keeps them in one txn).
      const placeholders = prepared.map((item, index) => ({
        rect: rects[index],
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
        contentType: item.contentType,
      }));
      const ids = createImagePlaceholders(doc, placeholders, deps.getIdentityId(), now);

      // 4. start each upload; it resolves independently and flips its own object.
      void Promise.all(
        ids.map(async (id, index) => {
          uploadsRef.current.set(id, { file: prepared[index].file, mine: true });
          await startUpload(id, prepared[index].file);
        }),
      );
      return ids;
    },
    [deps, startUpload],
  );

  const retry = useCallback(
    async (objectId: string): Promise<void> => {
      if (!deps.canEdit()) return;
      const record = uploadsRef.current.get(objectId);
      if (!record || !record.mine) return;
      const doc = deps.getDoc();
      const now = deps.now();
      if (!markImageRetrying(doc, objectId, now)) return;
      await startUpload(objectId, record.file);
    },
    [deps, startUpload],
  );

  const getProgress = useCallback(
    (id: string): number => progress[id] ?? 0,
    [progress],
  );

  return { progress, insert, retry, getProgress };
}