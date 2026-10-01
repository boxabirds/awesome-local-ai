/**
 * useImageInsert: manages drop, paste, and picker flows for adding images to the board.
 * Handles validation, placeholder creation, upload with progress, and retry.
 */
import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld, type Point } from '../canvas/camera';
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

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  showToast(message: string): void;
  getViewCentre(): Point | null;
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

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function hasFiles(e: DragEvent | ClipboardEvent): boolean {
  if ('dataTransfer' in e && e.dataTransfer) {
    return Array.from(e.dataTransfer.types).includes('Files');
  }
  if ('clipboardData' in e && e.clipboardData) {
    return Array.from(e.clipboardData.types).includes('Files');
  }
  return false;
}

function isConnectionOk(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, showToast, getViewCentre } = args;

  const [isDragging, setIsDragging] = useState(false);
  const [progressMap, setProgressMap] = useState<ReadonlyMap<string, number>>(new Map());
  const dragCounterRef = useRef(0);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  // getViewCentre is already from args, no need to compute locally

  const processFiles = useCallback(
    async (files: readonly File[], anchor: 'top-left' | 'centre', anchorPoint: Point) => {
      // Offline gate
      if (!isConnectionOk(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      // Validate
      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) {
        showToast(REJECTION_MESSAGES[r]);
      }

      if (accepted.length === 0) return;

      // Get natural sizes via createImageBitmap
      const items: { rect: import('../../shared/geometry').Rect; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
      const fileToItem = new Map<File, number>();

      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          const size = placementSize(bitmap.width, bitmap.height);
          bitmap.close();
          const idx = items.length;
          items.push({ rect: { x: 0, y: 0, width: size.width, height: size.height }, naturalWidth: bitmap.width, naturalHeight: bitmap.height, contentType: file.type });
          fileToItem.set(file, idx);
        } catch {
          // Decode failed → type toast, skip file
          showToast(REJECTION_MESSAGES.type);
        }
      }

      if (items.length === 0) return;

      // Layout row
      const rects = layoutRow(items.map((i) => ({ width: i.rect.width, height: i.rect.height })), anchorPoint, anchor);
      for (let i = 0; i < items.length; i++) {
        items[i].rect = rects[i];
      }

      // Create placeholders in one transaction (one undo step)
      const now = Date.now();
      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Map ids to files for retry
      for (let i = 0; i < ids.length; i++) {
        const file = accepted.find((f) => fileToItem.get(f) === i);
        if (file) {
          fileMapRef.current.set(ids[i], file);
        }
      }

      // Upload each in parallel
      for (const id of ids) {
        const file = fileMapRef.current.get(id);
        if (!file) continue;
        const upload = uploadImage(boardId, file, (fraction) => {
          setProgressMap((prev) => {
            const next = new Map(prev);
            next.set(id, fraction);
            return next;
          });
        });
        upload.promise.then((result) => {
          // Clean progress entry
          setProgressMap((prev) => {
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
    [doc, boardId, identityId, showToast],
  );

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (!isConnectionOk(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Convert drop point to world coordinates
      const dropScreen: Point = { x: e.offsetX, y: e.offsetY };
      const dropWorld = screenToWorld(cameraRef.current, dropScreen);

      processFiles(Array.from(files), 'top-left', dropWorld);
    },
    [processFiles, showToast],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Ignore paste while editing text
      if (isTextEntry(e.target)) return;

      if (!hasFiles(e)) return;

      if (!isConnectionOk(connectionRef.current)) {
        e.preventDefault();
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;

      e.preventDefault();
      const centre = getViewCentre();
      if (!centre) return;
      processFiles(Array.from(files), 'centre', centre);
    },
    [processFiles, showToast, getViewCentre],
  );

  const openPicker = useCallback(() => {
    if (!isConnectionOk(connectionRef.current)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      document.body.removeChild(input);
      if (files.length === 0) return;
      const centre = getViewCentre();
      if (!centre) return;
      processFiles(files, 'centre', centre);
    });

    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
    });

    input.click();
  }, [processFiles, showToast, getViewCentre]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMapRef.current.get(id);
      if (!file) return false;
      if (!isConnectionOk(connectionRef.current)) {
        showToast(REJECTION_MESSAGES.offline);
        return false;
      }
      markImageRetrying(doc, id, Date.now());
      const upload = uploadImage(boardId, file, (fraction) => {
        setProgressMap((prev) => {
          const next = new Map(prev);
          next.set(id, fraction);
          return next;
        });
      });
      upload.promise.then((result) => {
        setProgressMap((prev) => {
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
    [doc, boardId, showToast],
  );

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    isDragging,
    progress: progressMap,
    retry,
    canRetry,
  };
}
