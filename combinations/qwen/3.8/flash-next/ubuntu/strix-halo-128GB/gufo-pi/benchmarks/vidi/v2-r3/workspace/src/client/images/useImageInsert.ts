/**
 * useImageInsert hook: drop, paste, picker flows, validation, upload, retry (story 12).
 */
import { useCallback, useRef, useState, useEffect } from 'react';
import * as Y from 'yjs';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
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
import type { Size } from '../../shared/geometry';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewport?: { width: number; height: number };
  showToast(text: string): void;
  onToolReset?(): void;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  isDragging: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewport, showToast, onToolReset } = args;

  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const dragDepthRef = useRef(0);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const progressRef = useRef<Map<string, number>>(new Map());
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const identityIdRef = useRef(identityId);
  identityIdRef.current = identityId;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const onToolResetRef = useRef(onToolReset);
  onToolResetRef.current = onToolReset;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Set up hidden file input
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    fileInputRef.current = input;

    const handleChange = () => {
      const files = input.files ? Array.from(input.files) : [];
      if (files.length > 0) {
        addFiles(files, 'centre');
      }
      input.value = '';
      onToolResetRef.current?.();
    };

    input.addEventListener('change', handleChange);
    return () => {
      input.removeEventListener('change', handleChange);
      document.body.removeChild(input);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isConnected = useCallback((): boolean => {
    return connectionRef.current === 'connected' || connectionRef.current === 'confirmed';
  }, []);

  const getViewCentre = useCallback((): { x: number; y: number } => {
    const vp = viewportRef.current ?? { width: window.innerWidth, height: window.innerHeight };
    return screenToWorld(cameraRef.current, { x: vp.width / 2, y: vp.height / 2 });
  }, []);

  const addFiles = useCallback(async (files: File[], anchor: 'top-left' | 'centre', dropPoint?: { x: number; y: number }) => {
    // Offline gate
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);

    // Show rejection messages
    if (rejections.has('type')) showToastRef.current(REJECTION_MESSAGES.type);
    if (rejections.has('size')) showToastRef.current(REJECTION_MESSAGES.size);
    if (rejections.has('count')) showToastRef.current(REJECTION_MESSAGES.count);

    if (accepted.length === 0) return;

    // Get natural dimensions from createImageBitmap
    const sizes: Size[] = [];
    const validFiles: File[] = [];

    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        sizes.push({ width: bitmap.width, height: bitmap.height });
        validFiles.push(file);
        bitmap.close?.();
      } catch {
        // Decode failed → type rejection for this file
        showToastRef.current(REJECTION_MESSAGES.type);
      }
    }

    if (validFiles.length === 0) return;

    // Compute placement sizes
    const placeSizes = validFiles.map((_, i) => placementSize(sizes[i].width, sizes[i].height));

    // Layout
    const startPoint = anchor === 'top-left' && dropPoint ? dropPoint : getViewCentre();
    const rects = layoutRow(placeSizes, startPoint, anchor);

    // Create placeholders (one undo step)
    const now = Date.now();
    const items = rects.map((rect, i) => ({
      rect,
      naturalWidth: sizes[i].width,
      naturalHeight: sizes[i].height,
      contentType: validFiles[i].type,
    }));

    const ids = createImagePlaceholders(doc, items, identityIdRef.current, now);
    if (ids.length === 0) return;

    // Store files for retry
    for (let i = 0; i < ids.length; i++) {
      fileMapRef.current.set(ids[i], validFiles[i]);
    }

    // Upload each file
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = validFiles[i];

      const handle = uploadImage(boardIdRef.current, file, (fraction) => {
        progressRef.current.set(id, fraction);
        setProgress(new Map(progressRef.current));
      });

      const result = await handle.promise;

      progressRef.current.delete(id);
      setProgress(new Map(progressRef.current));

      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
      } else {
        markImageFailed(doc, id);
      }
    }
  }, [doc, isConnected]);

  const onDragOver = useCallback((e: DragEvent) => {
    // Only handle file drags
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current++;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    dragDepthRef.current--;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    // Offline gate
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }

    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;

    // Convert screen drop point to world coords
    const targetEl = e.target as HTMLElement | null;
    const viewportEl = targetEl?.closest?.('[data-testid="board-viewport"]') as HTMLElement | null;
    const rect = viewportEl?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(cameraRef.current, screenPoint);

    addFiles(files, 'top-left', worldPoint);
  }, [isConnected, addFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    // Ignore when in a text field
    if (isTextEntry(e.target)) return;

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

    // Offline gate
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }

    e.preventDefault();
    addFiles(imageFiles, 'centre');
  }, [isConnected, addFiles]);

  const openPicker = useCallback(() => {
    // Offline gate
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [isConnected]);

  const retry = useCallback((id: string): boolean => {
    const file = fileMapRef.current.get(id);
    if (!file) return false;

    markImageRetrying(doc, id, Date.now());

    const handle = uploadImage(boardIdRef.current, file, (fraction) => {
      progressRef.current.set(id, fraction);
      setProgress(new Map(progressRef.current));
    });

    handle.promise.then((result) => {
      progressRef.current.delete(id);
      setProgress(new Map(progressRef.current));

      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
      } else {
        markImageFailed(doc, id);
      }
    });

    return true;
  }, [doc]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  return {
    onDragOver,
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
