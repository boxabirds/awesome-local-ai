import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Point } from '@/shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '@/shared/config';
import { screenToWorld, type Camera, type Size } from '@/client/canvas/camera';
import type { ConnectionState } from '@/client/sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '@/shared/objects/image';

/**
 * Story 12 — adding images by drop, paste and picker (image.insert and friends).
 *
 * Every entry point funnels through `processFiles(files, worldPoint, anchor)`:
 *
 *   1. offline gate — if the board is not `connected`/`confirmed`, show the
 *      offline toast and do nothing (image.offline);
 *   2. `validateFiles` — count/type/size rejections become toasts (image.types,
 *      image.size_limit, image.count_limit);
 *   3. `createImageBitmap` per accepted file for its natural size — a decode
 *      failure is a type rejection (image.types);
 *   4. `createImagePlaceholders` — one LOCAL_ORIGIN transaction (one undo step);
 *   5. parallel `uploadImage` with progress; the result maps to
 *      `markImageReady` / `markImageFailed` (UPLOAD_ORIGIN) and a rate toast.
 *
 * The uploader keeps the accepted `File`s in memory (keyed by object id) so a
 * failed image can be retried (image.upload_failure); after a reload only
 * Remove is offered. The `progress` map (uploader only) feeds ImageObject's
 * uploading state (image.uploading).
 *
 * NOTE: the design contract lists `{ doc, boardId, camera, connection,
 * identityId }`; `viewport` is additionally required here because centring the
 * picker/paste in view (image.pick, image.paste) needs the visible-area centre,
 * which is the camera only in combination with the viewport size.
 */
export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewport: Size;
}

export interface UseImageInsert {
  /** Drag handlers for the board viewport (file drags only). */
  onDragEnter(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  /** Opens the OS file picker (I key / Image button); centres in view. */
  openPicker(): void;
  /** True while a file drag hovers the board (drives the drop highlight). */
  dragActive: boolean;
  /** Uploader-only upload progress, image id → 0..1 fraction. */
  progress: ReadonlyMap<string, number>;
  /** Re-uploads a failed image when its File is still in memory. */
  retry(id: string): boolean;
  /** True when the image's File is still in memory (Retry is offered). */
  canRetry(id: string): boolean;
  /** The active toast messages (exact PRD wording). */
  toasts: readonly string[];
}

function isTextEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function isFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

function imageFilesFromClipboard(e: ClipboardEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];
  const files: File[] = [];
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) files.push(f);
    return files;
  }
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsert {
  const { doc, identityId } = args;

  // Latest values for use inside stable event handlers / async callbacks.
  const cameraRef = useRef(args.camera);
  cameraRef.current = args.camera;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const viewportRef = useRef(args.viewport);
  viewportRef.current = args.viewport;
  const boardIdRef = useRef(args.boardId);
  boardIdRef.current = args.boardId;

  // In-memory id → File for Retry (lost on reload); in-flight uploads for abort.
  const filesRef = useRef(new Map<string, File>());
  const uploadsRef = useRef(new Map<string, UploadHandle>());

  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [toasts, setToasts] = useState<string[]>([]);
  const toastTimer = useRef<number | null>(null);

  const showToasts = useCallback((messages: string[]): void => {
    if (messages.length === 0) return;
    setToasts([...new Set(messages)]);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToasts([]);
      toastTimer.current = null;
    }, 5000);
  }, []);

  const updateProgress = useCallback((id: string, fraction: number): void => {
    setProgress((prev) => {
      const prevPct = prev.has(id) ? Math.round((prev.get(id) as number) * 100) : -1;
      const nextPct = Math.round(fraction * 100);
      if (nextPct === prevPct) return prev; // no visible change → no re-render
      const next = new Map(prev);
      next.set(id, fraction);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File): void => {
      const handle = uploadImage(boardIdRef.current, file, (frac) => updateProgress(id, frac));
      uploadsRef.current.set(id, handle);
      void handle.promise.then((result) => {
        uploadsRef.current.delete(id);
        setProgress((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(doc, id);
          showToasts([REJECTION_MESSAGES.rate]);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [doc, updateProgress, showToasts],
  );

  const processFiles = useCallback(
    async (files: File[], worldPoint: Point, anchor: 'top-left' | 'centre'): Promise<void> => {
      // 1. Offline gate (image.offline).
      const conn = connectionRef.current;
      if (conn !== 'connected' && conn !== 'confirmed') {
        showToasts([REJECTION_MESSAGES.offline]);
        return;
      }
      // 2. Client-side validation (image.types / size_limit / count_limit).
      const { accepted, rejections } = validateFiles(files);
      const msgs: string[] = [];
      if (rejections.has('type')) msgs.push(REJECTION_MESSAGES.type);
      if (rejections.has('size')) msgs.push(REJECTION_MESSAGES.size);
      if (rejections.has('count')) msgs.push(REJECTION_MESSAGES.count);
      if (accepted.length === 0) {
        showToasts(msgs);
        return;
      }
      // 3. Natural size per file (decode failure → type rejection, image.types).
      const measured: { file: File; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
      for (const f of accepted) {
        try {
          const bmp = await createImageBitmap(f);
          measured.push({ file: f, naturalWidth: bmp.width, naturalHeight: bmp.height, contentType: f.type });
          bmp.close?.();
        } catch {
          msgs.push(REJECTION_MESSAGES.type);
        }
      }
      if (measured.length === 0) {
        showToasts(msgs);
        return;
      }
      // 4. Placeholders: placementSize + layoutRow, one LOCAL_ORIGIN transaction.
      const sizes = measured.map((m) => placementSize(m.naturalWidth, m.naturalHeight));
      const rects = layoutRow(sizes, worldPoint, anchor);
      const items = measured.map((m, i) => ({
        rect: rects[i],
        naturalWidth: m.naturalWidth,
        naturalHeight: m.naturalHeight,
        contentType: m.contentType,
      }));
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      showToasts(msgs);
      // 5. Parallel uploads with progress (image.uploading).
      measured.forEach((m, i) => {
        const id = ids[i];
        filesRef.current.set(id, m.file);
        startUpload(id, m.file);
      });
    },
    [doc, identityId, showToasts, startUpload],
  );

  // --- Drag and drop (image.drop). ---
  const onDragEnter = useCallback((e: DragEvent): void => {
    if (isFileDrag(e)) {
      e.preventDefault();
      setDragActive(true);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent): void => {
    if (isFileDrag(e)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent): void => {
    if (!isFileDrag(e)) return;
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget instanceof Node && e.currentTarget.contains(related)) return;
    setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent): void => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragActive(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      void processFiles(files, world, 'top-left');
    },
    [processFiles],
  );

  // --- Paste (image.paste): ignored while editing text or with no image. ---
  const onPaste = useCallback(
    (e: ClipboardEvent): void => {
      if (isTextEditableTarget(e.target)) return;
      const files = imageFilesFromClipboard(e);
      if (files.length === 0) return;
      e.preventDefault();
      const centre = screenToWorld(cameraRef.current, {
        x: viewportRef.current.width / 2,
        y: viewportRef.current.height / 2,
      });
      void processFiles(files, centre, 'centre');
    },
    [processFiles],
  );

  useEffect(() => {
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // --- Picker (image.pick): a hidden multiple file input, centred in view. ---
  const openPicker = useCallback((): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = (IMAGE_ACCEPTED_TYPES as readonly string[]).join(',');
    input.style.display = 'none';
    input.onchange = (): void => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      if (files.length === 0) return;
      const centre = screenToWorld(cameraRef.current, {
        x: viewportRef.current.width / 2,
        y: viewportRef.current.height / 2,
      });
      void processFiles(files, centre, 'centre');
    };
    document.body.appendChild(input);
    input.click();
  }, [processFiles]);

  // --- Retry / Remove support (image.upload_failure). ---
  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  // Abort in-flight uploads and clear the toast timer on unmount.
  useEffect(() => {
    const uploads = uploadsRef.current;
    const timer = toastTimer;
    return () => {
      for (const handle of uploads.values()) handle.abort();
      uploads.clear();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    dragActive,
    progress,
    retry,
    canRetry,
    toasts,
  };
}
