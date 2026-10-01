import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { screenToWorld } from '../canvas/camera';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  type ImagePlaceholderItem,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';

const TOAST_DISMISS_MS = 5000;

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Current viewport size in screen px (for the view-centre anchor). */
  viewportSize: { width: number; height: number };
}

export interface UseImageInsertResult {
  onDragOver(e: React.DragEvent): void;
  onDragEnter(e: React.DragEvent): void;
  onDragLeave(e: React.DragEvent): void;
  onDrop(e: React.DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** Change handler for the hidden file input (story 12, image.pick). */
  onPickerChange(e: React.ChangeEvent<HTMLInputElement>): void;
  /** Upload progress (0..1) per object id — uploader only. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** True while files are dragged over the board (renders DropHighlight). */
  dragActive: boolean;
  /** Current toast message, or null. */
  toast: string | null;
  /** Ref to the hidden file input; render it once in the tree. */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewportSize } = args;

  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // In-memory id → File map for Retry (lost on reload by design).
  const filesRef = useRef<Map<string, File>>(new Map());
  const dragDepth = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the latest connection/camera in refs so stable callbacks read fresh values.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewportSize);
  viewportRef.current = viewportSize;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const setProgressFor = useCallback((id: string, value: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(id);
      else next.set(id, value);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const handle = uploadImage(boardId, file, (fraction) => setProgressFor(id, fraction));
      void handle.promise.then((result) => {
        setProgressFor(id, null);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [boardId, doc, setProgressFor],
  );

  /**
   * Common add path for drop / paste / picker.
   * `anchor` + `start` (world) place the row; offline, validation, decode and
   * upload failures are all surfaced as toasts, never thrown.
   */
  const addFiles = useCallback(
    async (fileList: File[], anchor: 'top-left' | 'centre', start: Point) => {
      // Offline gate: nothing is created or uploaded.
      const conn = connectionRef.current;
      if (conn !== 'connected' && conn !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(fileList);
      for (const r of rejections) showToast(REJECTION_MESSAGES[r]);
      if (accepted.length === 0) return;

      // Decode each accepted file for its natural size; a decode failure is a
      // type problem (skip the file, toast once).
      const decoded: { file: File; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
      let decodeFailed = false;
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          decoded.push({
            file,
            naturalWidth: bitmap.width,
            naturalHeight: bitmap.height,
            contentType: file.type,
          });
          bitmap.close();
        } catch {
          decodeFailed = true;
        }
      }
      if (decodeFailed) showToast(REJECTION_MESSAGES.type);
      if (decoded.length === 0) return;

      const sizes = decoded.map((d) => placementSize(d.naturalWidth, d.naturalHeight));
      const rects = layoutRow(sizes, start, anchor);
      const items: ImagePlaceholderItem[] = decoded.map((d, i) => ({
        rect: rects[i],
        naturalWidth: d.naturalWidth,
        naturalHeight: d.naturalHeight,
        contentType: d.contentType,
      }));
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());

      decoded.forEach((d, i) => {
        const id = ids[i];
        if (!id) return;
        filesRef.current.set(id, d.file);
        startUpload(id, d.file);
      });
    },
    [doc, identityId, startUpload, showToast],
  );

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // required to allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      void addFiles(files, 'top-left', world);
    },
    [addFiles],
  );

  // ── Paste ──────────────────────────────────────────────────────────────────
  const isEditingTarget = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable
    );
  };

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Leave paste to the editor while any text field is focused.
      if (isEditingTarget(document.activeElement)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      const centreScreen = { x: viewportRef.current.width / 2, y: viewportRef.current.height / 2 };
      const world = screenToWorld(cameraRef.current, centreScreen);
      void addFiles(files, 'centre', world);
    },
    [addFiles],
  );

  // Window paste listener (active only while this board is mounted).
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // ── Picker ─────────────────────────────────────────────────────────────────
  const openPicker = useCallback(() => {
    const conn = connectionRef.current;
    if (conn !== 'connected' && conn !== 'confirmed') {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [showToast]);

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // allow re-picking the same file
      if (files.length === 0) return;
      const centreScreen = { x: viewportRef.current.width / 2, y: viewportRef.current.height / 2 };
      const world = screenToWorld(cameraRef.current, centreScreen);
      void addFiles(files, 'centre', world);
    },
    [addFiles],
  );

  // ── Retry ──────────────────────────────────────────────────────────────────
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
    onPickerChange,
    progress,
    retry,
    canRetry,
    dragActive,
    toast,
    fileInputRef,
  };
}

export const ACCEPT_ATTR = IMAGE_ACCEPTED_TYPES.join(',');
