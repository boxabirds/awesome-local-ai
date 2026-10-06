/**
 * useImageInsert: the hook that wires drop, paste, and picker to image upload.
 *
 * Entry points: onDragOver/onDrop for drag-and-drop, onPaste for clipboard,
 * openPicker for the Image tool. All three validate, create placeholders, and upload.
 * The hook manages an in-memory map of id → File for retry, lost on page reload.
 */

import { useCallback, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  type Size
} from '../../shared/objects/image';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewportRef: RefObject<HTMLDivElement | null>;
  connection: ConnectionState;
  identityId: string;
  showToast(text: string): void;
  /** The centre of the visible area, in screen coords. */
  viewCentre: Point;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** True while files are dragged over the board. */
  dropActive: boolean;
  /** The hidden file input ref for rendering. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange(e: Event): void;
  onDragEnter(e: DragEvent): void;
}

/** Check if connection is usable for uploads. */
function isConnected(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

export function useImageInsert(options: UseImageInsertOptions): UseImageInsertResult {
  const { doc, boardId, camera, viewportRef, connection, identityId, showToast, viewCentre } = options;

  const [dropActive, setDropActive] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const progressRef = useRef<Map<string, number>>(new Map());
  const fileMap = useRef<Map<string, File>>(new Map());
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // We need refs for values that are read inside once-attached event handlers
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewCentreRef = useRef(viewCentre);
  viewCentreRef.current = viewCentre;

  const updateProgress = useCallback((id: string, fraction: number) => {
    progressRef.current.set(id, fraction);
    setProgress(new Map(progressRef.current));
  }, []);

  const clearProgress = useCallback((id: string) => {
    progressRef.current.delete(id);
    setProgress(new Map(progressRef.current));
  }, []);

  /** Process accepted files: measure, place, upload. */
  const processFiles = useCallback(
    async (files: File[], anchorPoint: Point, anchor: 'top-left' | 'centre') => {
      // Measure natural sizes via createImageBitmap
      const measured: { file: File; naturalWidth: number; naturalHeight: number }[] = [];
      let decodeFailed = false;

      for (const file of files) {
        try {
          const bitmap = await createImageBitmap(file);
          measured.push({ file, naturalWidth: bitmap.width, naturalHeight: bitmap.height });
          bitmap.close();
        } catch {
          decodeFailed = true;
        }
      }

      if (decodeFailed) {
        showToast(REJECTION_MESSAGES.type);
      }

      if (measured.length === 0) return;

      // Compute placement sizes and layout
      const sizes: Size[] = measured.map((m) => placementSize(m.naturalWidth, m.naturalHeight));
      const rects = layoutRow(sizes, anchorPoint, anchor);

      // Create placeholders in one transaction
      const items = measured.map((m, i) => ({
        rect: rects[i],
        naturalWidth: m.naturalWidth,
        naturalHeight: m.naturalHeight,
        contentType: m.file.type
      }));

      const ids = createImagePlaceholders(doc, items, identityId, Date.now());

      // Upload each file
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const file = measured[i].file;
        fileMap.current.set(id, file);
        updateProgress(id, 0);

        const handle = uploadImage(boardId, file, (fraction) => {
          updateProgress(id, fraction);
        });

        const result = await handle.promise;
        clearProgress(id);

        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      }
    },
    [doc, boardId, identityId, showToast, updateProgress, clearProgress]
  );

  const handleDropOrPaste = useCallback(
    (rawFiles: File[], anchorPoint: Point, anchor: 'top-left' | 'centre') => {
      if (!isConnected(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(rawFiles);

      // Show rejection toasts
      if (rejections.has('type')) showToast(REJECTION_MESSAGES.type);
      if (rejections.has('size')) showToast(REJECTION_MESSAGES.size);
      if (rejections.has('count')) showToast(REJECTION_MESSAGES.count);

      if (accepted.length === 0) return;

      void processFiles(accepted, anchorPoint, anchor);
    },
    [processFiles, showToast]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    // Only handle file drags
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragCounter.current++;
    setDropActive(true);
  }, []);

  const onDragLeave = useCallback((_e: DragEvent) => {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDropActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDropActive(false);

      if (!isConnected(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // Convert drop point to world coordinates
      const rect = viewportRef.current?.getBoundingClientRect();
      const screenPoint: Point = rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: e.clientX, y: e.clientY };
      const worldPoint = screenToWorld(cameraRef.current, screenPoint);

      handleDropOrPaste(files, worldPoint, 'top-left');
    },
    [handleDropOrPaste, showToast, viewportRef]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Only handle if the board (not a text editor) has focus
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const files: File[] = [];
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;

      e.preventDefault();

      if (!isConnected(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      // Centre in visible area
      handleDropOrPaste(files, viewCentreRef.current, 'centre');
    },
    [handleDropOrPaste, showToast]
  );

  const openPicker = useCallback(() => {
    if (!isConnected(connectionRef.current)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [showToast]);

  const onFileInputChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement;
      const files = Array.from(input.files ?? []);
      input.value = ''; // reset so same file can be picked again

      if (files.length === 0) return;

      if (!isConnected(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      handleDropOrPaste(files, viewCentreRef.current, 'centre');
    },
    [handleDropOrPaste, showToast]
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMap.current.get(id);
      if (!file) return false;
      markImageRetrying(doc, id, Date.now());

      updateProgress(id, 0);
      void uploadImage(boardId, file, (fraction) => {
        updateProgress(id, fraction);
      }).promise.then((result) => {
        clearProgress(id);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });
      return true;
    },
    [doc, boardId, updateProgress, clearProgress]
  );

  const canRetry = useCallback(
    (id: string): boolean => {
      return fileMap.current.has(id);
    },
    []
  );

  return {
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    dropActive,
    fileInputRef,
    onFileInputChange
  };
}
