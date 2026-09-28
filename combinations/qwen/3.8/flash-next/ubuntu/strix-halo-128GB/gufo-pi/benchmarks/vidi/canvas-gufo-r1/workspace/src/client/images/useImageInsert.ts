import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
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
import type { Camera } from '../canvas/camera';
import type { Point } from '../../shared/geometry';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera & { vw: number; vh: number };
  connection: ConnectionState;
  identityId: string;
  showToast(text: string): void;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  dragging: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

function isEditingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

function hasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.types.includes('Files');
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, showToast } = args;
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());

  const progressRef = useRef<Map<string, number>>(new Map());
  const fileMap = useRef<Map<string, File>>(new Map());
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const docRef = useRef(doc);
  docRef.current = doc;
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;

  const updateProgress = useCallback((id: string, fraction: number) => {
    progressRef.current = new Map(progressRef.current);
    progressRef.current.set(id, fraction);
    setProgress(progressRef.current);
  }, []);

  const clearProgress = useCallback((id: string) => {
    progressRef.current = new Map(progressRef.current);
    progressRef.current.delete(id);
    setProgress(progressRef.current);
  }, []);

  const isConnected = useCallback(() => {
    return connectionRef.current === 'connected' || connectionRef.current === 'confirmed';
  }, []);

  /** Get centre of visible viewport in world coords */
  const getCentre = useCallback((): Point => {
    const cam = cameraRef.current;
    return { x: (cam.vw / 2) / cam.zoom + cam.x, y: (cam.vh / 2) / cam.zoom + cam.y };
  }, []);

  const startUploads = useCallback((ids: string[], files: File[]) => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = files[i];
      if (!file) continue;
      fileMap.current.set(id, file);
      updateProgress(id, 0);

      const handle = uploadImage(boardIdRef.current, file, (fraction) => {
        updateProgress(id, fraction);
      });

      handle.promise.then((result) => {
        clearProgress(id);
        if (result.kind === 'ok') {
          markImageReady(docRef.current, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(docRef.current, id);
          showToastRef.current(REJECTION_MESSAGES.rate);
        } else {
          markImageFailed(docRef.current, id);
        }
      });
    }
  }, [updateProgress, clearProgress]);

  /** Decode a file's natural dimensions. Returns null on failure. */
  const decodeFile = useCallback(async (file: File): Promise<{ width: number; height: number } | null> => {
    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file);
        const w = bitmap.width;
        const h = bitmap.height;
        if (typeof bitmap.close === 'function') bitmap.close();
        return { width: w, height: h };
      }
      // Fallback: use natural dimensions from image element
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(file);
      });
    } catch {
      return null;
    }
  }, []);

  const addFiles = useCallback(async (files: readonly File[], anchor: 'top-left' | 'centre', point: Point) => {
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

    // Decode dimensions for each accepted file
    const decoded: { file: File; width: number; height: number }[] = [];
    for (const file of accepted) {
      const dims = await decodeFile(file);
      if (!dims || dims.width === 0 || dims.height === 0) {
        showToastRef.current(REJECTION_MESSAGES.type);
        continue;
      }
      decoded.push({ file, ...dims });
    }

    if (decoded.length === 0) return;

    // Compute placement sizes and layout
    const sizes = decoded.map((d) => placementSize(d.width, d.height));
    const rects = layoutRow(sizes, point, anchor);

    // Create placeholders
    const items = decoded.map((d, i) => ({
      rect: rects[i],
      naturalWidth: d.width,
      naturalHeight: d.height,
      contentType: d.file.type,
    }));
    const ids = createImagePlaceholders(docRef.current, items, identityRef.current, Date.now());

    // Start uploads
    startUploads(ids, decoded.map((d) => d.file));
  }, [isConnected, decodeFile, startUploads]);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDragging(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Convert screen point to world
    const cam = cameraRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = { x: screenX / cam.zoom + cam.x, y: screenY / cam.zoom + cam.y };

    addFiles(Array.from(files), 'top-left', world);
  }, [addFiles]);

  const onPaste = useCallback((e: ClipboardEvent) => {
    if (isEditingContext(e.target)) return;
    const items = e.clipboardData?.files;
    if (!items || items.length === 0) return;

    // Check if any files are images
    const imageFiles = Array.from(items).filter((f) =>
      IMAGE_ACCEPTED_TYPES.includes(f.type as typeof IMAGE_ACCEPTED_TYPES[number]),
    );
    if (imageFiles.length === 0) return;

    e.preventDefault();
    addFiles(imageFiles, 'centre', getCentre());
  }, [addFiles, getCentre]);

  const openPicker = useCallback(() => {
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = input.files;
      document.body.removeChild(input);
      if (!files || files.length === 0) return;
      addFiles(Array.from(files), 'centre', getCentre());
    });

    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
    });

    input.click();
  }, [addFiles, getCentre, isConnected]);

  const retry = useCallback((id: string): boolean => {
    const file = fileMap.current.get(id);
    if (!file) return false;
    if (!isConnected()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return false;
    }

    markImageRetrying(docRef.current, id, Date.now());
    updateProgress(id, 0);

    const handle = uploadImage(boardIdRef.current, file, (fraction) => {
      updateProgress(id, fraction);
    });

    handle.promise.then((result) => {
      clearProgress(id);
      if (result.kind === 'ok') {
        markImageReady(docRef.current, id, result.assetKey);
      } else if (result.kind === 'rate_limited') {
        markImageFailed(docRef.current, id);
        showToastRef.current(REJECTION_MESSAGES.rate);
      } else {
        markImageFailed(docRef.current, id);
      }
    });

    return true;
  }, [isConnected, updateProgress, clearProgress]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMap.current.has(id);
  }, []);

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    dragging,
    progress,
    retry,
    canRetry,
  };
}
