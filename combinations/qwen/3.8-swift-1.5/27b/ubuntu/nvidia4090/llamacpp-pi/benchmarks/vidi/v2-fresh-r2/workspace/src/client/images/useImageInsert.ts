/**
 * Image insert hook (story 12, image.insert).
 *
 * Owns all three ways of adding images — drop, paste, picker — plus the
 * offline gate, per-file validation, natural-size measurement, placeholder
 * creation, parallel XHR uploads with progress, and retry.
 *
 * - Offline (ConnectionState not connected/confirmed): a toast, nothing added.
 * - Drop: placeholders in a row with the first image's top-left at the drop
 *   point (top-left anchor).
 * - Paste / picker: placeholders centred on the visible board (centre anchor).
 * - Files that fail to decode (createImageBitmap) are dropped with a type
 *   toast. A file that fails to upload marks the object failed; the uploader
 *   can retry (the file is kept in memory).
 */

import { useCallback, useRef, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES, type FileRejection } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  type ImageItem,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type { ToastItem } from '../ui/Toast';

const TOAST_MS = 4000;

/** Minimal drag-event shape (React synthetic events satisfy this). */
export interface DragLike {
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer | null;
  preventDefault(): void;
}

/** Minimal paste-event shape (clipboardData exposes `files` like DataTransfer). */
export interface PasteLike {
  clipboardData: DataTransfer | null;
  preventDefault(): void;
}

/** Collect files from a FileList (or null). */
function filesFrom(files: FileList | null | undefined): File[] {
  if (!files) return [];
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) out.push(files[i]);
  return out;
}

export interface ImageInsert {
  onDragOver(e: DragLike): void;
  onDragEnter(e: DragLike): void;
  onDragLeave(e: DragLike): void;
  onDrop(e: DragLike): void;
  onPaste(e: PasteLike): void;
  openPicker(): void;
  /** Per-object upload progress (fraction 0..1) for objects this client uploads. */
  progress: ReadonlyMap<string, number>;
  toasts: readonly ToastItem[];
  dragActive: boolean;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isConnected(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

function isEditingText(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function hasFiles(e: DragLike): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

function viewCentre(camera: Camera): Point {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  return screenToWorld(camera, { x: w / 2, y: h / 2 });
}

/** Measure a file's natural pixel size; null if it fails to decode. */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    try {
      bitmap.close();
    } catch {
      /* ignore */
    }
    return dims;
  } catch {
    return null;
  }
}

/**
 * Wire up image insert for a board.
 */
export function useImageInsert(a: {
  doc: YDoc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
}): ImageInsert {
  const docRef = useRef(a.doc);
  docRef.current = a.doc;
  const cameraRef = useRef(a.camera);
  cameraRef.current = a.camera;
  const connectionRef = useRef(a.connection);
  connectionRef.current = a.connection;
  const identityRef = useRef(a.identityId);
  identityRef.current = a.identityId;
  const boardIdRef = useRef(a.boardId);
  boardIdRef.current = a.boardId;

  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const filesRef = useRef<Map<string, File>>(new Map());
  const toastIdRef = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_MS);
  }, []);

  const setProgressFor = useCallback((id: string, fraction: number) => {
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(id, fraction);
      return next;
    });
  }, []);

  const uploadOne = useCallback(
    (id: string, file: File) => {
      filesRef.current.set(id, file);
      const { promise } = uploadImage(boardIdRef.current, file, (fraction) => {
        setProgressFor(id, fraction);
      });
      promise.then((result) => {
        if (result.kind === 'ok') {
          markImageReady(docRef.current, id, result.assetKey);
          setProgressFor(id, 1);
        } else {
          markImageFailed(docRef.current, id);
        }
      });
    },
    [setProgressFor],
  );

  const addFilesAt = useCallback(
    async (files: File[], point: Point, anchor: 'top-left' | 'centre') => {
      // Offline gate first: a toast, nothing added.
      if (!isConnected(connectionRef.current)) {
        toast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) {
        toast(REJECTION_MESSAGES[r as FileRejection]);
      }
      if (accepted.length === 0) return;

      // Measure natural sizes; drop files that fail to decode.
      const measured: Array<{ file: File; width: number; height: number }> = [];
      let decodeFailed = false;
      for (const file of accepted) {
        const dims = await measure(file);
        if (dims === null) {
          decodeFailed = true;
          continue;
        }
        measured.push({ file, width: dims.width, height: dims.height });
      }
      if (decodeFailed) toast(REJECTION_MESSAGES.type);
      if (measured.length === 0) return;

      const sizes = measured.map((m) => placementSize(m.width, m.height));
      const rects = layoutRow(sizes, point, anchor);
      const items: ImageItem[] = measured.map((m, i) => ({
        rect: rects[i],
        naturalWidth: m.width,
        naturalHeight: m.height,
        contentType: m.file.type,
      }));
      const ids = createImagePlaceholders(docRef.current, items, identityRef.current, Date.now());
      measured.forEach((m, i) => uploadOne(ids[i], m.file));
    },
    [toast, uploadOne],
  );

  const onDragOver = useCallback(
    (e: DragLike) => {
      if (hasFiles(e)) {
        e.preventDefault();
        setDragActive(true);
      }
    },
    [],
  );

  const onDragEnter = useCallback(
    (e: DragLike) => {
      if (hasFiles(e)) {
        e.preventDefault();
        setDragActive(true);
      }
    },
    [],
  );

  const onDragLeave = useCallback(
    (e: DragLike) => {
      if (hasFiles(e)) {
        e.preventDefault();
        setDragActive(false);
      }
    },
    [],
  );

  const onDrop = useCallback(
    (e: DragLike) => {
      e.preventDefault();
      setDragActive(false);
      const files = filesFrom(e.dataTransfer?.files);
      if (files.length === 0) return;
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      void addFilesAt(files, world, 'top-left');
    },
    [addFilesAt],
  );

  const onPaste = useCallback(
    (e: PasteLike) => {
      if (isEditingText()) return;
      const files = filesFrom(e.clipboardData?.files);
      if (files.length === 0) return;
      e.preventDefault();
      const centre = viewCentre(cameraRef.current);
      void addFilesAt(files, centre, 'centre');
    },
    [addFilesAt],
  );

  const openPicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.multiple = true;
    input.style.display = 'none';
    input.dataset.testid = 'image-file-input';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) {
        const centre = viewCentre(cameraRef.current);
        void addFilesAt(files, centre, 'centre');
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }, [addFilesAt]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      markImageRetrying(docRef.current, id, Date.now());
      uploadOne(id, file);
      return true;
    },
    [uploadOne],
  );

  const canRetry = useCallback((id: string): boolean => {
    return filesRef.current.has(id);
  }, []);

  return {
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    toasts,
    dragActive,
    retry,
    canRetry,
  };
}
