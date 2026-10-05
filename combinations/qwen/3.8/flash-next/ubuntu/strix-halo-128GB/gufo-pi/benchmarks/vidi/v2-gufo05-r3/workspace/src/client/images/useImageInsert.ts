/**
 * useImageInsert: orchestrates drop, paste, picker, validation, upload, retry (story 12).
 */
import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import { setUploadEntry, removeUploadEntry } from './retryRegistry';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
  type CreateImageItem,
} from '../../shared/objects/image';
import type { Size, Point } from '../../shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewportRef?: { current: HTMLElement | null };
  viewportCentreWorld?: () => Point;
  onToast?(message: string): void;
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
  dropHighlightVisible: boolean;
}

function isConnected(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.tagName !== 'string') return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewportRef, viewportCentreWorld, onToast } = args;

  const [progressMap, setProgressMap] = useState<ReadonlyMap<string, number>>(new Map());
  const [dropHighlightVisible, setDropHighlightVisible] = useState(false);
  const dragCounter = useRef(0);

  // In-memory map of id → File for retry (lost on reload)
  const fileMap = useRef<Map<string, File>>(new Map());
  const progressRef = useRef<Map<string, number>>(new Map());

  const updateProgress = useCallback((id: string, fraction: number) => {
    progressRef.current = new Map(progressRef.current);
    progressRef.current.set(id, fraction);
    setProgressMap(progressRef.current);
  }, []);

  const clearProgress = useCallback((id: string) => {
    progressRef.current = new Map(progressRef.current);
    progressRef.current.delete(id);
    setProgressMap(progressRef.current);
  }, []);

  const getViewportCentre = useCallback((): Point => {
    if (viewportCentreWorld) return viewportCentreWorld();
    // Fallback: compute from camera assuming 800x600 viewport
    return { x: camera.x + 400 / camera.zoom, y: camera.y + 300 / camera.zoom };
  }, [camera, viewportCentreWorld]);

  const doUpload = useCallback((id: string, file: File) => {
    const handle = uploadImage(boardId, file, (fraction) => {
      updateProgress(id, fraction);
    });
    handle.promise.then((result) => {
      clearProgress(id);
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
        removeUploadEntry(id);
      } else {
        markImageFailed(doc, id);
        // Register in retry registry so ImageObjectWrapper can offer Retry
        setUploadEntry(id, {
          uploaderId: identityId,
          progress: 1,
          canRetry: true,
          retryFn: () => {
            markImageRetrying(doc, id, Date.now());
            updateProgress(id, 0);
            doUpload(id, file);
          },
        });
      }
    });
  }, [boardId, doc, identityId, updateProgress, clearProgress]);

  const processFiles = useCallback(async (
    files: readonly File[],
    anchorPoint: Point,
    anchor: 'top-left' | 'centre',
  ) => {
    if (!isConnected(connection)) {
      onToast?.(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);

    // Show rejection messages
    if (rejections.has('type')) onToast?.(REJECTION_MESSAGES.type);
    if (rejections.has('size')) onToast?.(REJECTION_MESSAGES.size);
    if (rejections.has('count')) onToast?.(REJECTION_MESSAGES.count);

    if (accepted.length === 0) return;

    // Get natural dimensions for each file using createImageBitmap
    const sizes: Size[] = [];
    const validFiles: File[] = [];
    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        sizes.push({ width: bitmap.width, height: bitmap.height });
        bitmap.close();
        validFiles.push(file);
      } catch {
        // Decode failure → type toast
        onToast?.(REJECTION_MESSAGES.type);
      }
    }

    if (validFiles.length === 0) return;

    // Compute placement sizes
    const placementSizes = sizes.map((s) => placementSize(s.width, s.height));

    // Layout
    const rects = layoutRow(placementSizes, anchorPoint, anchor);

    // Create items
    const items: CreateImageItem[] = validFiles.map((file, i) => ({
      rect: rects[i]!,
      naturalWidth: sizes[i]!.width,
      naturalHeight: sizes[i]!.height,
      contentType: file.type,
    }));

    // Create placeholders in one transaction (one undo step)
    const now = Date.now();
    const ids = createImagePlaceholders(doc, items, identityId, now);

    // Store files for retry and start uploads
    ids.forEach((id, i) => {
      fileMap.current.set(id, validFiles[i]!);
      updateProgress(id, 0);
      doUpload(id, validFiles[i]!);
    });
  }, [connection, doc, identityId, onToast, doUpload, updateProgress]);

  const onDragOver = useCallback((e: DragEvent) => {
    // Only for file drags
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDropHighlightVisible(false);
      }
    }
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current = 0;
    setDropHighlightVisible(false);

    if (!isConnected(connection)) {
      onToast?.(REJECTION_MESSAGES.offline);
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Convert screen point to world
    const el = viewportRef?.current;
    const rect = el?.getBoundingClientRect();
    const screenPoint: Point = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: e.clientX, y: e.clientY };
    const worldPoint = screenToWorld(camera, screenPoint);

    void processFiles(files, worldPoint, 'top-left');
  }, [connection, camera, viewportRef, onToast, processFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    // If focus is in a text editor, let it handle the paste
    if (isTypingTarget(e.target)) return;

    const files = Array.from(e.clipboardData?.files ?? []);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    if (!isConnected(connection)) {
      onToast?.(REJECTION_MESSAGES.offline);
      return;
    }

    e.preventDefault();
    const centre = getViewportCentre();
    void processFiles(imageFiles, centre, 'centre');
  }, [connection, getViewportCentre, onToast, processFiles]);

  const openPicker = useCallback(() => {
    if (!isConnected(connection)) {
      onToast?.(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      document.body.removeChild(input);
      if (files.length === 0) return;
      const centre = getViewportCentre();
      void processFiles(files, centre, 'centre');
    });

    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
    });

    input.click();
  }, [connection, onToast, getViewportCentre, processFiles]);

  const retry = useCallback((id: string): boolean => {
    const file = fileMap.current.get(id);
    if (!file) return false;
    if (!isConnected(connection)) {
      onToast?.(REJECTION_MESSAGES.offline);
      return false;
    }
    markImageRetrying(doc, id, Date.now());
    updateProgress(id, 0);
    doUpload(id, file);
    return true;
  }, [connection, doc, onToast, doUpload, updateProgress]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMap.current.has(id);
  }, []);

  return {
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress: progressMap,
    retry,
    canRetry,
    dropHighlightVisible,
  };
}
