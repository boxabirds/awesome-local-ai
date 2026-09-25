/**
 * Image insertion hook (story 12, image.insert).
 *
 * Handles all three entry points (drop, paste, picker) and the upload
 * lifecycle. The hook:
 *  - Gates on connection state (offline → toast, nothing created)
 *  - Validates files (type, size, count)
 *  - Measures dimensions via createImageBitmap
 *  - Creates placeholders in one LOCAL_ORIGIN transaction (one undo step)
 *  - Uploads in parallel with XHR progress
 *  - Tracks in-memory files for Retry (lost on reload)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point, Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { screenToWorld } from '../canvas/camera';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
} from '../../shared/objects/image';
import type { Rect } from '../../shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

// --- Helpers -----------------------------------------------------------------

/** Minimal drag event interface that works with both DOM and React events. */
export interface DragEventLike {
  clientX: number;
  clientY: number;
  preventDefault(): void;
  dataTransfer: DataTransfer | null;
}

/** Minimal paste event interface. */
export interface PasteEventLike {
  clipboardData: DataTransfer | null;
  preventDefault(): void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable;
}

function isFileDrag(e: DragEventLike): boolean {
  return e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files');
}

// --- Hook ---------------------------------------------------------------------

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  size: Size;
  connection: ConnectionState | null;
  identityId: string;
  showToast: (message: string) => void;
}

export interface UseImageInsertResult {
  onDragEnter(e: DragEventLike): void;
  onDragOver(e: DragEventLike): void;
  onDragLeave(e: DragEventLike): void;
  onDrop(e: DragEventLike): void;
  onPaste(e: PasteEventLike): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** Whether a file drag is currently over the viewport (for DropHighlight). */
  dragActive: boolean;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, identityId } = args;

  // Refs for values that change on every render.
  const cameraRef = useRef(args.camera);
  cameraRef.current = args.camera;
  const sizeRef = useRef(args.size);
  sizeRef.current = args.size;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const showToastRef = useRef(args.showToast);
  showToastRef.current = args.showToast;

  // State.
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // In-memory file map for Retry (lost on reload by design).
  const fileMapRef = useRef<Map<string, File>>(new Map());

  // Hidden file input for the picker.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      const centre = screenToWorld(cameraRef.current, {
        x: sizeRef.current.width / 2,
        y: sizeRef.current.height / 2,
      });
      void addFiles(files, centre, 'centre');
    });
    document.body.appendChild(input);
    fileInputRef.current = input;
    return () => {
      document.body.removeChild(input);
      fileInputRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Core: validate, measure, create placeholders, upload.
  const addFiles = useCallback(
    async (files: File[], point: Point, anchor: 'top-left' | 'centre'): Promise<void> => {
      // Offline gate.
      const conn = connectionRef.current;
      if (conn !== 'connected' && conn !== 'confirmedConnected') {
        showToastRef.current(REJECTION_MESSAGES.offline);
        return;
      }

      // Validate.
      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) {
        showToastRef.current(REJECTION_MESSAGES[r]);
      }
      if (accepted.length === 0) return;

      // Measure dimensions via createImageBitmap (parallel).
      const results = await Promise.all(
        accepted.map(async (file) => {
          try {
            const bitmap = await createImageBitmap(file);
            return { file, naturalWidth: bitmap.width, naturalHeight: bitmap.height, ok: true };
          } catch {
            return { file, naturalWidth: 0, naturalHeight: 0, ok: false };
          }
        }),
      );

      // Decode failures → type toast.
      if (results.some((r) => !r.ok)) {
        showToastRef.current(REJECTION_MESSAGES.type);
      }

      const valid = results.filter((r): r is typeof r & { ok: true } => r.ok);
      if (valid.length === 0) return;

      // Compute display sizes and layout.
      const sizes = valid.map((r) => placementSize(r.naturalWidth, r.naturalHeight));
      const rects = layoutRow(sizes, point, anchor);

      // Create placeholders (one LOCAL_ORIGIN transaction = one undo step).
      const items = valid.map((r, i) => ({
        rect: rects[i]!,
        naturalWidth: r.naturalWidth,
        naturalHeight: r.naturalHeight,
        contentType: r.file.type,
      }));
      const now = Date.now();
      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Store files for retry.
      valid.forEach((r, i) => {
        const id = ids[i];
        if (id !== undefined) fileMapRef.current.set(id, r.file);
      });

      // Start uploads in parallel.
      valid.forEach((r, i) => {
        const id = ids[i];
        if (id === undefined) return;
        const file = r.file;

        uploadImage(boardId, file, (fraction) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.set(id, fraction);
            return next;
          });
        }).promise.then((result) => {
          if (result.kind === 'ok') {
            markImageReady(doc, id, result.assetKey);
          } else if (result.kind === 'rate_limited') {
            markImageFailed(doc, id);
            showToastRef.current(REJECTION_MESSAGES.rate);
          } else {
            markImageFailed(doc, id);
          }
        });
      });
    },
    [doc, boardId, identityId],
  );

  // Drop handlers.
  const onDragEnter = useCallback((e: DragEventLike) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEventLike) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEventLike) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEventLike) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragActive(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // Convert drop point to world coordinates.
      const cam = cameraRef.current;
      const world = screenToWorld(cam, { x: e.clientX, y: e.clientY });

      void addFiles(files, world, 'top-left');
    },
    [addFiles],
  );

  // Paste handler.
  const onPaste = useCallback(
    (e: PasteEventLike) => {
      // Ignore when focus is in a text editor (paste text as before).
      if (isTypingTarget(document.activeElement)) return;

      const dt = e.clipboardData;
      if (dt === null) return;
      const items = dt.items;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file !== null) imageFiles.push(file);
        }
      }
      if (imageFiles.length === 0) return;

      e.preventDefault();
      const centre = screenToWorld(cameraRef.current, {
        x: sizeRef.current.width / 2,
        y: sizeRef.current.height / 2,
      });
      void addFiles(imageFiles, centre, 'centre');
    },
    [addFiles],
  );

  // Picker.
  const openPicker = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  // Retry.
  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMapRef.current.get(id);
      if (file === undefined) return false;

      // Reset to uploading with a new timestamp.
      const ok = markImageRetrying(doc, id, Date.now());
      if (!ok) return false;

      uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, fraction);
          return next;
        });
      }).promise.then((result) => {
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(doc, id);
          showToastRef.current(REJECTION_MESSAGES.rate);
        } else {
          markImageFailed(doc, id);
        }
      });

      return true;
    },
    [doc, boardId],
  );

  const canRetry = useCallback(
    (id: string): boolean => fileMapRef.current.has(id),
    [],
  );

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    dragActive,
  };
}
