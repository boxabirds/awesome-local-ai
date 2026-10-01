/**
 * useImageInsert: manages drop, paste and picker flows for adding images to the board.
 */

import { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import type { Point } from '../../shared/geometry';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
} from '../../shared/objects/image';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';

export interface UseImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewportWidth: number;
  viewportHeight: number;
  connection: ConnectionState | undefined;
  identityId: string;
  showToast(message: string): void;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDragEnter(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  isDragging: boolean;
}

function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

function hasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  for (const t of Array.from(dataTransfer.types)) {
    if (t === 'Files') return true;
  }
  return false;
}

interface DecodedImage {
  file: File;
  naturalWidth: number;
  naturalHeight: number;
  width: number;
  height: number;
  contentType: string;
}

export function useImageInsert(opts: UseImageInsertOptions): UseImageInsertResult {
  const { doc, boardId, camera, viewportWidth, viewportHeight, connection, identityId, showToast } = opts;

  const [isDragging, setIsDragging] = useState(false);
  const [progressMap, setProgressMap] = useState<ReadonlyMap<string, number>>(new Map());
  const dragCounterRef = useRef(0);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const uploadHandlesRef = useRef<Map<string, UploadHandle>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOffline = connection !== undefined && connection !== 'connected' && connection !== 'confirmed';

  const getViewCentre = useCallback((): Point => {
    return screenToWorld(camera, { x: viewportWidth / 2, y: viewportHeight / 2 });
  }, [camera, viewportWidth, viewportHeight]);

  const updateProgress = useCallback((id: string, fraction: number) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.set(id, fraction);
      return next;
    });
  }, []);

  const removeProgress = useCallback((id: string) => {
    setProgressMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const handle = uploadImage(boardId, file, (fraction) => {
        updateProgress(id, fraction);
      });
      uploadHandlesRef.current.set(id, handle);

      handle.promise.then((result) => {
        uploadHandlesRef.current.delete(id);
        removeProgress(id);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [doc, boardId, updateProgress, removeProgress],
  );

  const processFiles = useCallback(
    async (files: readonly File[], anchor: Point, anchorMode: 'top-left' | 'centre') => {
      if (isOffline) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);

      if (rejections.has('type')) showToast(REJECTION_MESSAGES.type);
      if (rejections.has('size')) showToast(REJECTION_MESSAGES.size);
      if (rejections.has('count')) showToast(REJECTION_MESSAGES.count);

      if (accepted.length === 0) return;

      // Decode images to get natural dimensions
      const decoded: DecodedImage[] = [];
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          const nw = bitmap.width;
          const nh = bitmap.height;
          bitmap.close();
          const { width, height } = placementSize(nw, nh);
          decoded.push({ file, naturalWidth: nw, naturalHeight: nh, width, height, contentType: file.type });
        } catch {
          showToast(REJECTION_MESSAGES.type);
        }
      }

      if (decoded.length === 0) return;

      // Layout row
      const sizes = decoded.map((d) => ({ width: d.width, height: d.height }));
      const rects = layoutRow(sizes, anchor, anchorMode);

      const items = decoded.map((d, i) => ({
        rect: rects[i]!,
        naturalWidth: d.naturalWidth,
        naturalHeight: d.naturalHeight,
        contentType: d.contentType,
      }));

      // Create placeholders (one undo step)
      const now = Date.now();
      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Store files for retry and start uploads
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const file = decoded[i]!.file;
        fileMapRef.current.set(id, file);
        startUpload(id, file);
      }
    },
    [doc, identityId, isOffline, showToast, startUpload],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // Convert drop point to world coordinates
      const vp = document.querySelector('[data-testid="board-viewport"]');
      const rect = vp?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPoint = screenToWorld(camera, screenPoint);

      processFiles(files, worldPoint, 'top-left');
    },
    [camera, processFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (isEditingText()) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length === 0) return;
      e.preventDefault();

      const centre = getViewCentre();
      processFiles(files, centre, 'centre');
    },
    [getViewCentre, processFiles],
  );

  const openPicker = useCallback(() => {
    if (isOffline) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    if (!fileInputRef.current) {
      fileInputRef.current = document.createElement('input');
      fileInputRef.current.type = 'file';
      fileInputRef.current.multiple = true;
      fileInputRef.current.accept = IMAGE_ACCEPTED_TYPES.join(',');
      fileInputRef.current.style.display = 'none';
      document.body.appendChild(fileInputRef.current);
    }

    const input = fileInputRef.current;
    input.value = '';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) {
        const centre = getViewCentre();
        processFiles(files, centre, 'centre');
      }
    };
    input.click();
  }, [isOffline, showToast, getViewCentre, processFiles]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMapRef.current.get(id);
      if (!file) return false;
      if (isOffline) return false;

      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, isOffline, startUpload],
  );

  const canRetry = useCallback(
    (id: string): boolean => {
      return fileMapRef.current.has(id);
    },
    [],
  );

  return {
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress: progressMap,
    retry,
    canRetry,
    isDragging,
  };
}
