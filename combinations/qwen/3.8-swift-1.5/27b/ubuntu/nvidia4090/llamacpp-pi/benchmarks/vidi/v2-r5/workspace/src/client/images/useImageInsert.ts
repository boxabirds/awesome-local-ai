// src/client/images/useImageInsert.ts
// Drop, paste, and picker flows for adding images to the board.

import { useState, useCallback, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
  placementSize,
  layoutRow,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewportWidth: number;
  viewportHeight: number;
  showToast: (msg: string) => void;
}

export interface UseImageInsertResult {
  onDragOver(e: React.DragEvent): void;
  onDragEnter(e: React.DragEvent): void;
  onDragLeave(e: React.DragEvent): void;
  onDrop(e: React.DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  dragActive: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isFileDrag(e: React.DragEvent): boolean {
  return e.dataTransfer?.types?.includes('Files') ?? false;
}

function isEditingText(): boolean {
  const target = document.activeElement;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewportWidth, viewportHeight, showToast } = args;
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const filesRef = useRef<Map<string, File>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);

  const isOnline = connection === 'connected' || connection === 'confirmed';

  const addFiles = useCallback(async (files: File[], worldPoint: Point, anchor: 'top-left' | 'centre') => {
    if (!isOnline) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);

    // Show rejection toasts
    for (const reason of rejections) {
      showToast(REJECTION_MESSAGES[reason]);
    }

    if (accepted.length === 0) return;

    // Measure dimensions using createImageBitmap
    const items: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
    let hadDecodeFailure = false;

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
        bitmap.close();
      } catch {
        hadDecodeFailure = true;
      }
    }

    // If any files failed to decode, show type message
    if (hadDecodeFailure) {
      showToast(REJECTION_MESSAGES.type);
    }

    if (items.length === 0) return;

    // Layout
    const sizes = items.map((i) => ({ width: i.rect.width, height: i.rect.height }));
    const rects = layoutRow(sizes, worldPoint, anchor);

    // Create placeholders
    const finalItems = items.map((item, i) => ({
      ...item,
      rect: rects[i],
    }));

    const ids = createImagePlaceholders(doc, finalItems, identityId, Date.now());

    // Upload each file
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = accepted[i];
      filesRef.current.set(id, file);

      const handle = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, fraction);
          return next;
        });
      });

      handle.promise.then((result) => {
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
  }, [doc, boardId, identityId, isOnline, showToast]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    }
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      e.preventDefault();
      dragCounterRef.current++;
      setDragActive(true);
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) {
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setDragActive(false);
      }
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);

    const files = Array.from(e.dataTransfer!.files);
    if (files.length === 0) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(camera, screenPoint);

    addFiles(files, worldPoint, 'top-left');
  }, [camera, addFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    // Don't intercept paste while editing text
    if (isEditingText()) return;

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

    const centre: Point = { x: viewportWidth / 2, y: viewportHeight / 2 };
    const worldPoint = screenToWorld(camera, centre);
    addFiles(files, worldPoint, 'centre');
  }, [camera, viewportWidth, viewportHeight, addFiles]);

  const openPicker = useCallback(() => {
    if (!isOnline) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      inputRef.current = input;
      document.body.appendChild(input);
    }

    inputRef.current.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      (e.target as HTMLInputElement).value = '';
      if (files.length === 0) return;

      const centre: Point = { x: viewportWidth / 2, y: viewportHeight / 2 };
      const worldPoint = screenToWorld(camera, centre);
      addFiles(files, worldPoint, 'centre');
    };

    inputRef.current.click();
  }, [camera, isOnline, viewportWidth, viewportHeight, addFiles, showToast]);

  const retry = useCallback((id: string): boolean => {
    const file = filesRef.current.get(id);
    if (!file) return false;

    markImageRetrying(doc, id, Date.now());

    const handle = uploadImage(boardId, file, (fraction) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, fraction);
        return next;
      });
    });

    handle.promise.then((result) => {
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
  }, [doc, boardId]);

  const canRetry = useCallback((id: string): boolean => {
    return filesRef.current.has(id);
  }, []);

  // Register paste listener
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (inputRef.current) {
        document.body.removeChild(inputRef.current);
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
    dragActive,
    progress,
    retry,
    canRetry,
  };
}
