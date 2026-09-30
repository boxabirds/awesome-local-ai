import { useCallback, useRef, useState, type MutableRefObject, type DragEvent as ReactDragEvent } from 'react';
import * as Y from 'yjs';
import type { Camera } from '@client/canvas/camera';
import { screenToWorld } from '@client/canvas/camera';
import type { ConnectionState } from '@client/sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
  type Size,
} from '@shared/objects/image';
import type { ToastApi } from '@client/ui/Toast';

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  cameraRef: MutableRefObject<Camera>;
  connection: ConnectionState;
  identityId: string;
  viewportWidth: number;
  viewportHeight: number;
  toast: ToastApi;
}

export interface UseImageInsertResult {
  onDragOver(e: ReactDragEvent): void;
  onDragEnter(e: ReactDragEvent): void;
  onDragLeave(e: ReactDragEvent): void;
  onDrop(e: ReactDragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  dropHighlightVisible: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

export function useImageInsert(opts: UseImageInsertOptions): UseImageInsertResult {
  const { doc, cameraRef, connection, viewportWidth, viewportHeight, toast } = opts;

  const [dropHighlightVisible, setDropHighlightVisible] = useState(false);
  const [progressMap, setProgressMap] = useState<ReadonlyMap<string, number>>(new Map());
  const dragCounterRef = useRef(0);

  // In-memory map of id -> File for retry
  const fileMapRef = useRef<Map<string, File>>(new Map());

  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const isOnline = useCallback((): boolean => {
    const s = connectionRef.current;
    return s === 'connected' || s === 'confirmed';
  }, []);

  const getViewCentre = useCallback((): { x: number; y: number } => {
    const cam = cameraRef.current;
    const w = viewportWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const h = viewportHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
    return screenToWorld(cam, { x: w / 2, y: h / 2 });
  }, [cameraRef, viewportWidth, viewportHeight]);

  const updateProgress = useCallback((id: string, fraction: number) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.set(id, fraction);
      return next;
    });
  }, []);

  const clearProgress = useCallback((id: string) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const doUpload = useCallback(async (id: string, file: File) => {
    const o = optsRef.current;
    updateProgress(id, 0);
    const { promise } = uploadImage(o.boardId, file, (fraction) => {
      updateProgress(id, fraction);
    });
    const result = await promise;
    clearProgress(id);
    if (result.kind === 'ok') {
      markImageReady(o.doc, id, result.assetKey);
    } else {
      markImageFailed(o.doc, id);
    }
  }, [updateProgress, clearProgress]);

  const processFiles = useCallback(async (files: readonly File[], start: { x: number; y: number }, anchor: 'top-left' | 'centre') => {
    const o = optsRef.current;

    if (!isOnline()) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);

    // Show toast for each rejection type
    if (rejections.has('type')) toast.show(REJECTION_MESSAGES.type);
    if (rejections.has('size')) toast.show(REJECTION_MESSAGES.size);
    if (rejections.has('count')) toast.show(REJECTION_MESSAGES.count);

    if (accepted.length === 0) return;

    // Get natural sizes via createImageBitmap (or fallback)
    const sizes: Size[] = [];
    const validFiles: File[] = [];

    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        sizes.push(placementSize(bitmap.width, bitmap.height));
        validFiles.push(file);
        bitmap.close();
      } catch {
        // Decode failure - treat as type rejection
        toast.show(REJECTION_MESSAGES.type);
      }
    }

    if (validFiles.length === 0) return;

    const rects = layoutRow(sizes, start, anchor);

    const items = validFiles.map((file, i) => ({
      rect: rects[i],
      naturalWidth: 0, // will be set by placementSize result
      naturalHeight: 0,
      contentType: file.type,
    }));

    // Set natural dimensions from sizes (already placement-size-adjusted)
    for (let i = 0; i < items.length; i++) {
      items[i].naturalWidth = sizes[i].width;
      items[i].naturalHeight = sizes[i].height;
    }

    const now = Date.now();
    const ids = createImagePlaceholders(o.doc, items, o.identityId, now);

    // Store files for retry and start uploads
    for (let i = 0; i < ids.length; i++) {
      fileMapRef.current.set(ids[i], validFiles[i]);
      void doUpload(ids[i], validFiles[i]);
    }
  }, [isOnline, toast, doUpload]);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounterRef.current++;
      setDropHighlightVisible(true);
    }
  }, []);

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDragLeave = useCallback((_e: ReactDragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropHighlightVisible(false);
    }
  }, []);

  const onDrop = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDropHighlightVisible(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Convert drop point to world coordinates
    const o = optsRef.current;
    const cam = o.cameraRef.current;
    const el = (e.currentTarget as HTMLElement);
    const rect = el.getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(cam, screenPoint);

    void processFiles(Array.from(files), worldPoint, 'top-left');
  }, [processFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    // Check if focus is in a text editor
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable) {
        return; // Let the editor handle paste
      }
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length === 0) return;
    e.preventDefault();

    const centre = getViewCentre();
    void processFiles(imageFiles, centre, 'centre');
  }, [processFiles, getViewCentre]);

  const openPicker = useCallback(() => {
    if (!isOnline()) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = input.files;
      document.body.removeChild(input);
      if (!files || files.length === 0) return;
      const centre = getViewCentre();
      void processFiles(Array.from(files), centre, 'centre');
    });

    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
    });

    input.click();
  }, [isOnline, toast, getViewCentre, processFiles]);

  const retry = useCallback((id: string): boolean => {
    const file = fileMapRef.current.get(id);
    if (!file) return false;
    if (!isOnline()) {
      toast.show(REJECTION_MESSAGES.offline);
      return false;
    }
    markImageRetrying(doc, id, Date.now());
    void doUpload(id, file);
    return true;
  }, [doc, isOnline, toast, doUpload]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  return {
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    dropHighlightVisible,
    progress: progressMap,
    retry,
    canRetry,
  };
}
