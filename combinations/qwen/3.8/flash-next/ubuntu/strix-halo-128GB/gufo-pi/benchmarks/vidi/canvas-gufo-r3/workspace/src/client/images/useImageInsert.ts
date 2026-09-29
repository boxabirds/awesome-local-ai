import { useCallback, useRef, useState, useEffect } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '@client/canvas/camera';
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
} from '@shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '@shared/config';
import { showToast } from '@client/ui/Toast';

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewportSize?: { width: number; height: number };
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDragEnter(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  isDragging: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isConnected(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

function hasImageFiles(items: DataTransferItemList | FileList | null): boolean {
  if (!items) return false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if ('kind' in item && item.kind === 'file') return true;
    if ('type' in item && (item as File).type && (item as File).type.startsWith('image/')) return true;
  }
  return false;
}

export function useImageInsert(opts: UseImageInsertOptions): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId } = opts;
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const viewportSizeRef = useRef(opts.viewportSize || { width: 1280, height: 800 });
  viewportSizeRef.current = opts.viewportSize || { width: 1280, height: 800 };
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const progressMapRef = useRef<Map<string, number>>(new Map());

  const updateProgress = useCallback((id: string, fraction: number) => {
    progressMapRef.current.set(id, fraction);
    setProgress(new Map(progressMapRef.current));
  }, []);

  const clearProgress = useCallback((id: string) => {
    progressMapRef.current.delete(id);
    setProgress(new Map(progressMapRef.current));
  }, []);

  const processFiles = useCallback(async (
    files: readonly File[],
    worldPoint: Point,
    anchor: 'top-left' | 'centre',
  ) => {
    // Offline gate
    if (!isConnected(connectionRef.current)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);

    // Show rejection messages
    if (rejections.has('type')) showToast(REJECTION_MESSAGES.type);
    if (rejections.has('size')) showToast(REJECTION_MESSAGES.size);
    if (rejections.has('count')) showToast(REJECTION_MESSAGES.count);

    if (accepted.length === 0) return;

    // Get natural dimensions for each accepted file via createImageBitmap
    const validItems: { file: File; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
    let decodeFailed = false;

    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        validItems.push({
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

    if (decodeFailed && validItems.length === 0) {
      showToast(REJECTION_MESSAGES.type);
      return;
    }

    if (validItems.length === 0) return;

    // Compute placement sizes
    const sizes = validItems.map((item) => placementSize(item.naturalWidth, item.naturalHeight));

    // Layout in a row
    const rects = layoutRow(sizes, worldPoint, anchor);

    // Create placeholders in one transaction
    const placeholderItems = validItems.map((item, i) => ({
      rect: rects[i],
      naturalWidth: item.naturalWidth,
      naturalHeight: item.naturalHeight,
      contentType: item.contentType,
    }));

    const now = Date.now();
    const ids = createImagePlaceholders(doc, placeholderItems, identityId, now);

    // Start uploads in parallel
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = validItems[i].file;
      fileMapRef.current.set(id, file);

      const handle = uploadImage(boardId, file, (fraction) => {
        updateProgress(id, fraction);
      });

      handle.promise.then((result) => {
        clearProgress(id);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(doc, id);
          showToast(REJECTION_MESSAGES.rate);
        } else {
          markImageFailed(doc, id);
        }
      });
    }
  }, [doc, boardId, identityId, updateProgress, clearProgress]);

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files')) {
      e.preventDefault();
      dragCounterRef.current++;
      setIsDragging(true);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const files = Array.from(e.dataTransfer.files);
    let screenPoint: Point;
    const target = e.currentTarget as HTMLElement | null;
    if (target && typeof target.getBoundingClientRect === 'function') {
      const rect = target.getBoundingClientRect();
      screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    } else {
      screenPoint = { x: e.clientX, y: e.clientY };
    }
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screenPoint);

    processFiles(files, world, 'top-left');
  }, [processFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    // Ignore if focus is in a text editor/input
    const active = document.activeElement as HTMLElement | null;
    if (active) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;
    }

    if (!e.clipboardData) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;

    // Only process if there are image files
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    e.preventDefault();

    // Centre in view
    const cam = cameraRef.current;
    const vp = viewportSizeRef.current;
    const centre: Point = { x: vp.width / 2, y: vp.height / 2 };
    const world = screenToWorld(cam, centre);

    processFiles(imageFiles, world, 'centre');
  }, [processFiles]);

  const openPicker = useCallback(() => {
    if (!isConnected(connectionRef.current)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      document.body.appendChild(input);
      fileInputRef.current = input;

      input.addEventListener('change', () => {
        const files = input.files ? Array.from(input.files) : [];
        if (files.length > 0) {
          const cam = cameraRef.current;
          const vp = viewportSizeRef.current;
          const centre: Point = { x: vp.width / 2, y: vp.height / 2 };
          const world = screenToWorld(cam, centre);
          processFiles(files, world, 'centre');
        }
        input.value = '';
      });
    }

    fileInputRef.current.click();
  }, [processFiles]);

  const retry = useCallback((id: string): boolean => {
    const file = fileMapRef.current.get(id);
    if (!file) return false;
    if (!isConnected(connectionRef.current)) return false;

    markImageRetrying(doc, id, Date.now());

    const handle = uploadImage(boardId, file, (fraction) => {
      updateProgress(id, fraction);
    });

    handle.promise.then((result) => {
      clearProgress(id);
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
      } else if (result.kind === 'rate_limited') {
        markImageFailed(doc, id);
        showToast(REJECTION_MESSAGES.rate);
      } else {
        markImageFailed(doc, id);
      }
    });

    return true;
  }, [doc, boardId, updateProgress, clearProgress]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  // Cleanup file input on unmount
  useEffect(() => {
    return () => {
      if (fileInputRef.current) {
        document.body.removeChild(fileInputRef.current);
        fileInputRef.current = null;
      }
    };
  }, []);

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
  };
}
