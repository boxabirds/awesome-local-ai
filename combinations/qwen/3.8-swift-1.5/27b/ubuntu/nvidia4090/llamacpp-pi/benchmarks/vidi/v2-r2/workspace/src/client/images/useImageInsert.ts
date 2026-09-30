import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import { createImagePlaceholders, markImageReady, markImageFailed, markImageRetrying, placementSize, layoutRow } from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  showToast: (message: string) => void;
  viewportSize: { width: number; height: number };
}

/**
 * Hook that manages image insertion via drop, paste, and picker.
 * Handles validation, placeholder creation, upload with progress, and retry.
 */
export function useImageInsert({
  doc,
  boardId,
  camera,
  connection,
  identityId,
  showToast,
  viewportSize,
}: UseImageInsertArgs) {
  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileMap = useRef<Map<string, File>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  const isConnected = connection === 'connected' || connection === 'confirmed';

  // Create a hidden file input for the picker
  const ensureInput = useCallback(() => {
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = input.files ? [...input.files] : [];
        if (files.length > 0) {
          const centre = screenToWorld(cameraRef.current, { x: viewportSizeRef.current.width / 2, y: viewportSizeRef.current.height / 2 });
          addFiles(files, 'centre', centre);
        }
        // Reset so the same file can be picked again
        input.value = '';
      });
      document.body.appendChild(input);
      inputRef.current = input;
    }
    return inputRef.current;
  }, []);

  /**
   * Core logic: validate files, create placeholders, upload.
   * @param files - the files to add
   * @param anchor - 'top-left' for drop, 'centre' for paste/picker
   * @param start - the world coordinate to start from
   */
  const addFiles = useCallback(
    (files: File[], anchor: 'top-left' | 'centre', start: Point) => {
      if (!isConnected) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);

      // Show rejection toasts
      for (const rej of rejections) {
        showToast(REJECTION_MESSAGES[rej]);
      }

      if (accepted.length === 0) return;

      // Measure dimensions and create placeholders
      const measureAndCreate = async () => {
        const items: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
        const validFiles: File[] = [];

        for (const file of accepted) {
          try {
            const bitmap = await createImageBitmap(file);
            const size = placementSize(bitmap.width, bitmap.height);
            items.push({
              rect: { x: 0, y: 0, width: size.width, height: size.height },
              naturalWidth: bitmap.width,
              naturalHeight: bitmap.height,
              contentType: file.type,
            });
            validFiles.push(file);
            bitmap.close();
          } catch {
            // Decode failure → type rejection
            showToast(REJECTION_MESSAGES.type);
          }
        }

        if (items.length === 0) return;

        // Layout
        const sizes = items.map((i) => ({ width: i.rect.width, height: i.rect.height }));
        const rects = layoutRow(sizes, start, anchor);

        // Create placeholders (one undo step)
        const finalItems = items.map((item, i) => ({
          ...item,
          rect: rects[i],
        }));
        const ids = createImagePlaceholders(doc, finalItems, identityId, Date.now());

        // Upload each file
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const file = validFiles[i];
          fileMap.current.set(id, file);

          const { promise, abort: _abort } = uploadImage(boardId, file, (fraction) => {
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
        }
      };

      measureAndCreate();
    },
    [doc, boardId, identityId, isConnected, showToast]
  );

  // Drag and drop handlers (React DragEvent)
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes('Files')) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    []
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter.current++;
        setIsDragging(true);
      }
    },
    []
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounter.current--;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setIsDragging(false);
        }
      }
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      const files = e.dataTransfer?.files ? [...e.dataTransfer.files] : [];
      if (files.length === 0) return;

      // Convert drop point to world coordinates
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPoint = screenToWorld(camera, screenPoint);

      addFiles(files, 'top-left', worldPoint);
    },
    [camera, addFiles]
  );

  // Paste handler
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Ignore if focus is in a text editor
      const target = document.activeElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length === 0) return;
      e.preventDefault();

      // Centre in the visible board area
      const centre = screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 });
      addFiles(files, 'centre', centre);
    },
    [camera, viewportSize, addFiles]
  );

  // Open the file picker
  const openPicker = useCallback(() => {
    if (!isConnected) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    ensureInput().click();
  }, [isConnected, showToast, ensureInput]);

  // Retry a failed upload
  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMap.current.get(id);
      if (!file) return false;

      markImageRetrying(doc, id, Date.now());

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
    [doc, boardId]
  );

  // Check if a file is still in memory (can retry)
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
    isDragging,
    progress,
    retry,
    canRetry,
    addFiles,
  };
}
