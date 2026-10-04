/**
 * Story 12: useImageInsert — the hook that manages the drop, paste, and picker flows.
 *
 * Handles offline gating, file validation, image dimension measurement, placeholder
 * creation, XHR upload with progress, and retry.
 */

import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';

import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import type { Point } from '../../shared/geometry';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImagePlaceholderItem,
} from '../../shared/objects/image';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import type { ToastState } from '../ui/Toast';

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewport: { width: number; height: number };
  connection: ConnectionState;
  identityId: string;
  toast: ToastState;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDragEnter(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  handleFiles(files: File[]): void;
  isDragging: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

export function useImageInsert(opts: UseImageInsertOptions): UseImageInsertResult {
  const { doc, boardId, camera, viewport, connection, identityId, toast } = opts;

  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());

  const dragCounter = useRef(0);
  const fileMap = useRef(new Map<string, File>());
  const isConnected = connection === 'connected' || connection === 'confirmed';

  /** Get the centre of the visible board area in world coordinates. */
  const viewCentre = useCallback((): Point => {
    return screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
  }, [camera, viewport]);

  /** Process accepted files: measure, create placeholders, upload. */
  const processFiles = useCallback(
    async (files: readonly File[], anchor: Point, anchorMode: 'top-left' | 'centre') => {
      const { accepted, rejections } = validateFiles(files);

      // Show toast messages for rejections
      if (rejections.has('type')) toast.show(REJECTION_MESSAGES.type);
      if (rejections.has('size')) toast.show(REJECTION_MESSAGES.size);
      if (rejections.has('count')) toast.show(REJECTION_MESSAGES.count);

      if (accepted.length === 0) return;

      // Measure dimensions via createImageBitmap
      const sized: { file: File; naturalWidth: number; naturalHeight: number }[] = [];
      let decodeFailed = false;
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          sized.push({ file, naturalWidth: bitmap.width, naturalHeight: bitmap.height });
          bitmap.close?.();
        } catch {
          decodeFailed = true;
        }
      }
      if (decodeFailed) toast.show(REJECTION_MESSAGES.type);
      if (sized.length === 0) return;

      // Compute placement sizes and layout
      const sizes = sized.map((s) => placementSize(s.naturalWidth, s.naturalHeight));
      const rects = layoutRow(sizes, anchor, anchorMode);

      // Create placeholders in one transaction
      const items: ImagePlaceholderItem[] = sized.map((s, i) => ({
        rect: rects[i]!,
        naturalWidth: s.naturalWidth,
        naturalHeight: s.naturalHeight,
        contentType: s.file.type,
      }));

      const now = Date.now();
      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Start uploads
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const file = sized[i]!.file;
        fileMap.current.set(id, file);

        // Set initial progress
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, 0);
          return next;
        });

        const { promise } = uploadImage(boardId, file, (fraction) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.set(id, fraction);
            return next;
          });
        });

        promise.then((result) => {
          // Remove progress entry
          setProgress((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });

          if (result.kind === 'ok') {
            markImageReady(doc, id, result.assetKey);
          } else {
            markImageFailed(doc, id);
          }
        });
      }
    },
    [doc, boardId, identityId, toast],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);

      if (!isConnected) {
        toast.show(REJECTION_MESSAGES.offline);
        return;
      }

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Convert screen position to world coordinates
      const target = e.target instanceof HTMLElement ? e.target : null;
      const rect = target?.closest('[data-testid="board-viewport"]')?.getBoundingClientRect();
      const screenX = rect ? e.clientX - rect.left : e.clientX;
      const screenY = rect ? e.clientY - rect.top : e.clientY;
      const worldPoint = screenToWorld(camera, { x: screenX, y: screenY });

      void processFiles(Array.from(files), worldPoint, 'top-left');
    },
    [isConnected, camera, toast, processFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent | Event) => {
      // Skip if focus is in an editable element
      const target = e.target;
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const clipboardData = (e as any).clipboardData as DataTransfer | undefined;
      const items = clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      if (!isConnected) {
        toast.show(REJECTION_MESSAGES.offline);
        return;
      }

      e.preventDefault();
      void processFiles(imageFiles, viewCentre(), 'centre');
    },
    [isConnected, toast, processFiles, viewCentre],
  );

  const openPicker = useCallback(() => {
    if (!isConnected) {
      toast.show(REJECTION_MESSAGES.offline);
      return;
    }
    // Use the persistent file input rendered by BoardSurface.
    const input = document.querySelector<HTMLInputElement>('[data-testid="image-file-input"]');
    if (input) input.click();
  }, [isConnected, toast]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (!isConnected) {
        toast.show(REJECTION_MESSAGES.offline);
        return;
      }
      void processFiles(files, viewCentre(), 'centre');
    },
    [isConnected, toast, processFiles, viewCentre],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMap.current.get(id);
      if (!file) return false;
      if (!isConnected) return false;

      const now = Date.now();
      markImageRetrying(doc, id, now);

      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, 0);
        return next;
      });

      const { promise } = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, fraction);
          return next;
        });
      });

      promise.then((result) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });

        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });

      return true;
    },
    [doc, boardId, isConnected],
  );

  const canRetry = useCallback(
    (id: string): boolean => {
      return fileMap.current.has(id) && isConnected;
    },
    [isConnected],
  );

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    handleFiles,
    isDragging,
    progress,
    retry,
    canRetry,
  };
}
