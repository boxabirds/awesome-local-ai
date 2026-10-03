// useImageInsert: drop, paste, and picker flows for adding images.
// Story 12.

import { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { ToastApi } from '../ui/Toast';

interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  toast: ToastApi;
  viewportSize: { width: number; height: number };
}

export interface ImageInsertApi {
  onDragOver(e: React.DragEvent): void;
  onDrop(e: React.DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** True while a file drag is over the board (for DropHighlight). */
  isDragOver: boolean;
  setIsDragOver(v: boolean): void;
}

export function useImageInsert(args: UseImageInsertArgs): ImageInsertApi {
  const { doc, boardId, camera, connection, identityId, toast, viewportSize } = args;
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [isDragOver, setIsDragOver] = useState(false);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const dragCounterRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isConnected = connection === 'connected' || connection === 'confirmed';

  // Show rejection toasts
  const showRejections = useCallback((rejections: Set<string>) => {
    for (const r of rejections) {
      toast.show(REJECTION_MESSAGES[r as keyof typeof REJECTION_MESSAGES] ?? '');
    }
  }, [toast]);

  // Core: add validated files at a given layout
  const addFiles = useCallback(async (
    files: File[],
    startPoint: { x: number; y: number },
    anchor: 'top-left' | 'centre',
  ) => {
    // Measure dimensions (createImageBitmap with HTMLImageElement fallback)
    const items: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string; file: File }[] = [];
    const decodeFailures: File[] = [];

    for (const file of files) {
      try {
        let width: number, height: number;
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width;
          height = bitmap.height;
          bitmap.close();
        } catch {
          // Fallback: use HTMLImageElement (works in headless browsers)
          const url = URL.createObjectURL(file);
          try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('decode failed'));
              img.src = url;
            });
            width = img.naturalWidth;
            height = img.naturalHeight;
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        const size = placementSize(width, height);
        if (size.width === 0 || size.height === 0) {
          decodeFailures.push(file);
          continue;
        }
        items.push({
          rect: { x: 0, y: 0, width: size.width, height: size.height },
          naturalWidth: width,
          naturalHeight: height,
          contentType: file.type,
          file,
        });
      } catch {
        decodeFailures.push(file);
      }
    }

    if (decodeFailures.length > 0) {
      toast.show(REJECTION_MESSAGES.type);
    }

    if (items.length === 0) return;

    // Layout
    const sizes = items.map((it) => ({ width: it.rect.width, height: it.rect.height }));
    const rects = layoutRow(sizes, startPoint, anchor);

    // Create placeholders (one undo step)
    const placeholderItems = items.map((it, i) => ({
      rect: rects[i],
      naturalWidth: it.naturalWidth,
      naturalHeight: it.naturalHeight,
      contentType: it.contentType,
    }));
    const ids = createImagePlaceholders(doc, placeholderItems, identityId, Date.now());

    // Upload each file
    const newProgress = new Map(progress);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = items[i].file;
      fileMapRef.current.set(id, file);
      newProgress.set(id, 0);

      const { promise } = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const m = new Map(prev);
          m.set(id, fraction);
          return m;
        });
      });

      promise.then((result) => {
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
        setProgress((prev) => {
          const m = new Map(prev);
          m.delete(id);
          return m;
        });
      });
    }
    setProgress(newProgress);
  }, [doc, boardId, identityId, toast, progress]);

  // Drop handler
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (!isConnected) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const { accepted, rejections } = validateFiles(files);
    if (rejections.size > 0) showRejections(rejections);
    if (accepted.length === 0) return;

    // Convert drop point to world coordinates
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(camera, screenPoint);

    void addFiles(accepted, worldPoint, 'top-left');
  }, [isConnected, camera, toast, showRejections, addFiles]);

  // Drag over handler
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  // Drag enter/leave for counter
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounterRef.current++;
      setIsDragOver(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  // Paste handler
  const onPaste = useCallback((e: ClipboardEvent) => {
    // Don't intercept if focus is in a text editor
    const target = document.activeElement;
    if (target && (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )) {
      return;
    }

    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;

    if (!isConnected) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }

    e.preventDefault();
    const { accepted, rejections } = validateFiles(files);
    if (rejections.size > 0) showRejections(rejections);
    if (accepted.length === 0) return;

    // Centre in the visible area
    const centreScreen = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
    const centreWorld = screenToWorld(camera, centreScreen);
    void addFiles(accepted, centreWorld, 'centre');
  }, [isConnected, camera, toast, showRejections, addFiles, viewportSize]);

  // Picker
  const openPicker = useCallback(() => {
    if (!isConnected) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }

    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      document.body.appendChild(input);
      inputRef.current = input;
    }

    const input = inputRef.current;
    input.value = ''; // Reset so the same file can be re-selected
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;

      const { accepted, rejections } = validateFiles(files);
      if (rejections.size > 0) showRejections(rejections);
      if (accepted.length === 0) return;

      const centreScreen = { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      const centreWorld = screenToWorld(camera, centreScreen);
      void addFiles(accepted, centreWorld, 'centre');
    };
    input.click();
  }, [isConnected, camera, toast, showRejections, addFiles, viewportSize]);

  // Retry
  const retry = useCallback((id: string): boolean => {
    const file = fileMapRef.current.get(id);
    if (!file) return false;

    markImageRetrying(doc, id, Date.now());
    setProgress((prev) => {
      const m = new Map(prev);
      m.set(id, 0);
      return m;
    });

    const { promise } = uploadImage(boardId, file, (fraction) => {
      setProgress((prev) => {
        const m = new Map(prev);
        m.set(id, fraction);
        return m;
      });
    });

    promise.then((result) => {
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
      } else {
        markImageFailed(doc, id);
      }
      setProgress((prev) => {
        const m = new Map(prev);
        m.delete(id);
        return m;
      });
    });

    return true;
  }, [doc, boardId]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    isDragOver,
    setIsDragOver,
  };
}

// Expose the drag enter/leave as separate callbacks
// (React's onDragEnter/onDragLeave)
export function useDragCounter() {
  const counterRef = useRef(0);
  const [isOver, setIsOver] = useState(false);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      counterRef.current++;
      setIsOver(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    counterRef.current--;
    if (counterRef.current <= 0) {
      counterRef.current = 0;
      setIsOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const reset = useCallback(() => {
    counterRef.current = 0;
    setIsOver(false);
  }, []);

  return { isOver, onDragEnter, onDragLeave, onDragOver, reset };
}
