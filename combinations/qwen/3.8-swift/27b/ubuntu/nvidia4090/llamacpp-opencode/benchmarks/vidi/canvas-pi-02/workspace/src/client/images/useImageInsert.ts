// Image insertion (story 12, image.drop / image.paste / image.picker /
// image.uploads / image.unfinished): the one entry point for adding
// images to the board from drop, paste or the file picker.
//
// Flow per add action (one undo step, story 8):
//  1. validateFiles → toast the rejections (exact wording, image.toasts).
//  2. Read each accepted file's natural size (object URL + <img>).
//  3. layoutRow (top-left at the drop point for drops; centre of the
//     viewport for paste/picker) + placementSize (never upscale) →
//     createImagePlaceholders in a SINGLE LOCAL_ORIGIN transaction.
//  4. Upload each file to the asset API (dedup by File identity; the
//     placeholder keeps rendering "uploading" while in flight).
//     - permanent HTTP errors (4xx except 429) → markImageFailed.
//     - network / 429 / 5xx → keep "uploading", auto-retry (5 s while
//       connected; immediately on reconnect).
//  5. Success → markImageReady (UPLOAD_ORIGIN: not an undo step, TC-05).
//
// "Upload in progress" (image.unfinished) is derived at render time: an
// upload older than IMAGE_UPLOAD_STALE_MS renders unfinished — the uploader
// is responsible, the object syncs regardless.

import { useCallback, useEffect, useRef, type ChangeEvent, type RefObject } from 'react';
import * as Y from 'yjs';
import { IMAGE_UPLOAD_RETRY_INTERVAL_MS } from '../../shared/config';
import { objectsMap } from '../../shared/board-model';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import {
  createImagePlaceholders,
  imageSnapshot,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImageSnap,
} from '../../shared/objects/image';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage } from './uploadImage';

export type ImageInsertAnchor = 'drop' | 'paste' | 'picker';

/** A screen-space point (CSS pixels, viewport-relative). */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ImageInsertOptions {
  boardId: string;
  /** Live Y.Doc (null while disconnected). */
  getDoc: () => Y.Doc | null;
  /** Whether the board socket is connected (drives auto-retry). */
  isConnected: () => boolean;
  clientId: string;
  onToast: (message: string) => void;
  /** The live camera (BoardPage's `cameraRef.current.camera`). */
  getCamera: () => Camera;
  /** The live viewport size in CSS pixels (for centring). */
  getViewportSize: () => Size;
}

export interface ImageInsert {
  /** Adds `files` to the board. For drops, `point` is the drop position in
   *  viewport-relative screen pixels; paste/picker ignore it. */
  insertFiles: (files: File[], anchor: ImageInsertAnchor, point?: ScreenPoint) => void;
  /** Opens the native file picker (one-shot) and inserts the selection at
   *  the centre of the viewport (image.picker). */
  openPicker: () => void;
  /** Ref for the hidden file input BoardPage renders once in the tree. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** The picker input's change handler (BoardPage renders it). */
  onFileInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  /** True while at least one upload is in flight (BoardPage ticks the
   *  render clock so "unfinished" derives live). */
  anyUploading: () => boolean;
  /** The current image snapshots (for BoardPage rendering). */
  imageSnaps: () => ImageSnap[];
  /** Explicit retry of a failed upload (uploader's Retry button): re-stamp
   *  uploadStartedAt and re-upload. No-op for ids this session did not
   *  create (their uploader is elsewhere). */
  retryImage: (id: string) => void;
}

function readNaturalSize(file: File): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

export function useImageInsert(options: ImageInsertOptions): ImageInsert {
  const { boardId, getDoc, isConnected, clientId, onToast, getCamera, getViewportSize } = options;

  const stateRef = useRef({
    inflight: new Set<File>(),
    pending: new Map<string, File>(), // placeholder id → file (retryable failures)
    files: new Map<string, File>(), // placeholder id → file (this session's adds)
  });

  // The picker input is rendered by BoardPage (React-owned); this hook
  // only clicks it and handles its change event.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const insertFilesRef = useRef<(files: File[], anchor: ImageInsertAnchor, point?: ScreenPoint) => void>(
    () => {},
  );
  const onFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const files = Array.from(el.files ?? []);
    el.value = ''; // allow re-selecting the same file
    if (files.length > 0) insertFilesRef.current(files, 'picker');
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const s = stateRef.current;
      if (s.inflight.has(file)) return;
      s.inflight.add(file);
      void (async () => {
        const doc = getDoc();
        try {
          const assetKey = await uploadImage(boardId, file);
          if (doc !== null) markImageReady(doc, id, assetKey);
          s.pending.delete(id);
        } catch (err) {
          if (doc === null) {
            // Board lost: nothing to update; the object is gone.
          } else if (isPermanentUploadError(err)) {
            markImageFailed(doc, id);
          } else {
            // Retryable (network / 429 / 5xx): keep "uploading"; the tick
            // below retries while connected, and on reconnect.
            s.pending.set(id, file);
            onToast(REJECTION_MESSAGES.offline);
          }
        } finally {
          s.inflight.delete(file);
        }
      })();
    },
    [boardId, getDoc, onToast],
  );

  const insertFiles = useCallback(
    (files: File[], anchor: ImageInsertAnchor, point?: ScreenPoint) => {
      const { accepted, rejections } = validateFiles(files);
      for (const kind of rejections) onToast(REJECTION_MESSAGES[kind]);
      if (accepted.length === 0) return;

      void (async () => {
        const sized: { file: File; naturalWidth: number; naturalHeight: number }[] = [];
        for (const file of accepted) {
          try {
            const n = await readNaturalSize(file);
            sized.push({ file, ...n });
          } catch {
            onToast('Couldn\'t read that image.');
          }
        }
        if (sized.length === 0) return;

        const doc = getDoc();
        if (doc === null) {
          onToast(REJECTION_MESSAGES.offline);
          return;
        }

        const cam = getCamera();
        const size = getViewportSize();
        const start: Point =
          anchor === 'drop' && point !== undefined
            ? screenToWorld(cam, point)
            : screenToWorld(cam, { x: size.width / 2, y: size.height / 2 });
        const rects = layoutRow(
          sized.map(({ naturalWidth, naturalHeight }) => placementSize(naturalWidth, naturalHeight)),
          start,
          anchor === 'drop' ? 'top-left' : 'centre',
        );

        const now = Date.now();
        const items = sized.map((s, i) => ({
          rect: rects[i],
          naturalWidth: s.naturalWidth,
          naturalHeight: s.naturalHeight,
          contentType: s.file.type,
        }));
        const ids = createImagePlaceholders(doc, items, clientId, now);
        ids.forEach((id, i) => {
          stateRef.current.files.set(id, sized[i].file);
          startUpload(id, sized[i].file);
        });
      })();
    },
    [clientId, getCamera, getDoc, getViewportSize, onToast, startUpload],
  );
  insertFilesRef.current = insertFiles;

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Auto-retry (image.uploads): every 5 s while connected, retry every
  // pending upload (re-stamping uploadStartedAt, image.unfinished).
  useEffect(() => {
    const tick = () => {
      const s = stateRef.current;
      if (!isConnected() || s.pending.size === 0) return;
      const doc = getDoc();
      if (doc === null) return;
      const now = Date.now();
      for (const [id, file] of [...s.pending]) {
        if (s.inflight.has(file)) continue;
        if (markImageRetrying(doc, id, now)) startUpload(id, file);
      }
    };
    const interval = setInterval(tick, IMAGE_UPLOAD_RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [getDoc, isConnected, startUpload]);

  const anyUploading = useCallback(() => stateRef.current.inflight.size > 0, []);

  const retryImage = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const file = s.files.get(id);
      if (file === undefined) return;
      if (s.inflight.has(file)) return;
      const doc = getDoc();
      if (doc === null) return;
      if (markImageRetrying(doc, id, Date.now())) startUpload(id, file);
    },
    [getDoc, startUpload],
  );

  const imageSnaps = useCallback((): ImageSnap[] => {
    const doc = getDoc();
    if (doc === null) return [];
    const snaps: ImageSnap[] = [];
    for (const [id] of objectsMap(doc)) {
      const snap = imageSnapshot(doc, id);
      if (snap !== null) snaps.push(snap);
    }
    return snaps;
  }, [getDoc]);

  return { insertFiles, openPicker, fileInputRef, onFileInputChange, anyUploading, imageSnaps, retryImage };
}

function isPermanentUploadError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 500 &&
    (err as { status: number }).status !== 429
  );
}
