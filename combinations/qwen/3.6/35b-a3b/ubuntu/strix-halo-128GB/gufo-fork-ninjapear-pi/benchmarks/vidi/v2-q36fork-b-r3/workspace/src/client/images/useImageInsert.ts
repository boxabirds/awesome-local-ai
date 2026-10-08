/** Hook for image insertion flows: drop, paste, picker — story 12 */

import { useCallback, useRef, useMemo, useState } from 'react';
import * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_MAX_FILES_PER_ADD,
} from '@shared/config';
import {
  validateFiles,
  REJECTION_MESSAGES,
} from './validateFiles';
import { uploadImage } from './uploadImage';
// Re-export for convenience
export { validateFiles, REJECTION_MESSAGES } from './validateFiles';
export type FileRejection = 'type' | 'size' | 'count';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed' | 'load_failed';

/** In-memory store of File objects keyed by placeholder id (for Retry). Lost on reload by design. */
const retryMap = new Map<string, File>();

/** Progress map: placeholderId → fraction (0–1) */
interface ProgressMap extends Map<string, number> {}

interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  viewSize: { width: number; height: number };
  toast(message: string): void;
}

/**
 * Hooks into drag-drop, paste, and file picker to insert images on the board.
 */
export function useImageInsert(args: UseImageInsertArgs): {
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
} {
  const { doc, boardId, camera, connection, identityId, viewSize, toast } = args;
  const [progress, setProgress] = useState(new Map() as ProgressMap);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // Helpers ---------------------------------------------------------------

  /** Show a toast message if not offline */
  const showToast = useCallback(
    (msg: string) => {
      if (connection !== 'connected' && connection !== 'confirmed') return;
      toast(msg);
    },
    [connection, toast],
  );

  /** Process accepted files: measure dimensions, place, upload */
  const processAcceptedFiles = useCallback(
    async (files: File[], dropPoint?: { x: number; y: number }) => {
      if (!doc) return;

      // Measure natural sizes using createImageBitmap
      const items: Array<{ rect: any; naturalWidth: number; naturalHeight: number; contentType: string }> = [];
      for (const file of files) {
        try {
          const bitmap = await createImageBitmap(file);
          // placementSize: longest side at most 800, never upscale
          const longest = Math.max(bitmap.width, bitmap.height);
          const MAX_PLACE = 800;
          const scale = Math.min(1, MAX_PLACE / longest);
          const w = Math.round(bitmap.width * scale);
          const h = Math.round(bitmap.height * scale);
          items.push({
            rect: null, // filled in next step
            naturalWidth: w,
            naturalHeight: h,
            contentType: file.type || 'image/png',
          });
        } catch {
          // Decode failure → type toast for this file
          continue;
        }
      }

      if (items.length === 0) return;

      // Layout row
      let startX: number, startY: number;
      if (dropPoint) {
        startX = dropPoint.x;
        startY = dropPoint.y;
      } else {
        // Centre in visible area
        startX = camera.x + viewSize.width / (2 * camera.zoom);
        startY = camera.y + viewSize.height / (2 * camera.zoom);
      }

      // Calculate positions with gap
      const GAP = 24; // IMAGE_LAYOUT_GAP_WORLD
      const rects: any[] = [];
      let cx = startX;
      for (const item of items) {
        rects.push({ x: cx, y: startY, width: item.naturalWidth, height: item.naturalHeight });
        cx += item.naturalWidth + GAP;
      }

      // Create placeholders
      const { createImagePlaceholders, layoutRow, placementSize } = require('@shared/objects/image');
      const ids: string[] = [];
      const maxZ = getMaxZ(doc);
      const objects = doc.getMap('objects');
      const now = Date.now();

      try {
        doc.transact(() => {
          for (let i = 0; i < items.length; i++) {
            const id = crypto.randomUUID();
            const dataMap = new Y.Map();
            dataMap.set('type', 'image');
            dataMap.set('x', rects[i].x);
            dataMap.set('y', rects[i].y);
            dataMap.set('width', rects[i].width);
            dataMap.set('height', rects[i].height);
            dataMap.set('assetKey', null);
            dataMap.set('contentType', items[i].contentType);
            dataMap.set('naturalWidth', items[i].naturalWidth);
            dataMap.set('naturalHeight', items[i].naturalHeight);
            dataMap.set('status', 'uploading');
            dataMap.set('uploadStartedAt', now);
            dataMap.set('uploaderId', identityId);
            dataMap.set('z', maxZ + 1 + i);
            dataMap.set('createdAt', now);
            objects.set(id, dataMap);
            ids.push(id);
            retryMap.set(id, files[i]); // Store file for retry
          }
        });
      } catch {
        return;
      }

      // Upload each file
      for (let i = 0; i < items.length; i++) {
        const id = ids[i];
        const controller = new AbortController();
        abortControllersRef.current.set(id, controller);

        const uploader = uploadImage(boardId, files[i], (fraction) => {
          setProgress((prev) => {
            const next = new Map(prev);
            next.set(id, Math.round(fraction * 100));
            return next;
          });
        });

        uploader.promise.then((result) => {
          if (result.kind === 'ok') {
            markReady(doc, id, result.assetKey);
          } else {
            markFailed(doc, id);
          }
          abortControllersRef.current.delete(id);
        }).catch(() => {
          markFailed(doc, id);
          abortControllersRef.current.delete(id);
        });
      }
    },
    [doc, boardId, camera, identityId, viewSize],
  );

  // Event handlers --------------------------------------------------------

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only highlight for file drags (not text links)
    const hasFiles = Array.from(e.dataTransfer?.types ?? []).includes('Files');
    if (!hasFiles) return;
    e.dataTransfer!.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (connection !== 'connected' && connection !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;

      const files = Array.from(dt.files);
      const { accepted, rejections } = validateFiles(files);

      // Show rejection messages
      for (const rej of rejections) {
        showToast(REJECTION_MESSAGES[rej]);
      }

      if (accepted.length === 0) return;

      // Convert drop point to world coords
      const worldPoint = {
        x: e.clientX / camera.zoom + camera.x,
        y: e.clientY / camera.zoom + camera.y,
      };

      processAcceptedFiles(accepted, worldPoint);
    },
    [connection, camera, processAcceptedFiles, showToast],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Ignore if focus is in a text editing element
      const tag = (e.target as HTMLElement).tagName;
      const isInput =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (e.target as HTMLElement).getAttribute('contenteditable') === 'true';
      if (isInput) return;

      if (connection !== 'connected' && connection !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      const { accepted, rejections } = validateFiles(imageFiles);
      for (const rej of rejections) {
        showToast(REJECTION_MESSAGES[rej]);
      }

      if (accepted.length === 0) return;

      // No drop point — centre in view
      processAcceptedFiles(accepted);
    },
    [connection, processAcceptedFiles, showToast],
  );

  const openPicker = useCallback(() => {
    if (connection !== 'connected' && connection !== 'confirmed') {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.multiple = true;

    input.addEventListener('change', () => {
      if (!input.files || input.files.length === 0) return;
      const files = Array.from(input.files);
      const { accepted, rejections } = validateFiles(files);
      for (const rej of rejections) {
        showToast(REJECTION_MESSAGES[rej]);
      }
      if (accepted.length === 0) return;
      processAcceptedFiles(accepted);
      // Clean up
      input.remove();
    });

    input.click();
  }, [connection, processAcceptedFiles, showToast]);

  const canRetry = useCallback((id: string): boolean => {
    return retryMap.has(id);
  }, []);

  const retry = useCallback(
    (id: string): boolean => {
      const file = retryMap.get(id);
      if (!file || !doc) return false;

      // Reset status to uploading
      markRetrying(doc, id);

      // Remove old progress entry
      setProgress((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });

      // Upload again
      const controller = new AbortController();
      abortControllersRef.current.set(id, controller);

      const uploader = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, Math.round(fraction * 100));
          return next;
        });
      });

      uploader.promise.then((result) => {
        if (result.kind === 'ok') {
          markReady(doc, id, result.assetKey);
        } else {
          markFailed(doc, id);
        }
        abortControllersRef.current.delete(id);
      }).catch(() => {
        markFailed(doc, id);
        abortControllersRef.current.delete(id);
      });

      return true;
    },
    [doc, boardId],
  );

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress: useMemo(() => progress, [progress]),
    retry,
    canRetry,
  };
}

// Internal helpers ---------------------------------------------------------

function getMaxZ(doc: Y.Doc): number {
  const objects = doc.getMap('objects');
  let max = 0;
  for (const val of objects.values()) {
    if (!(val instanceof Y.Map)) continue;
    const z = Number(val.get('z') ?? 0);
    if (z > max) max = z;
  }
  return max;
}

function markReady(doc: Y.Doc, id: string, assetKey: string): boolean {
  const UPLOAD_ORIGIN = Symbol('upload-origin');
  const objects = doc.getMap('objects');
  const dm = objects.get(id);
  if (!dm || !(dm instanceof Y.Map)) return false;

  doc.transact(() => {
    dm.set('assetKey', assetKey);
    dm.set('status', 'ready');
  }, UPLOAD_ORIGIN);

  return true;
}

function markFailed(doc: Y.Doc, id: string): boolean {
  const UPLOAD_ORIGIN = Symbol('upload-origin');
  const objects = doc.getMap('objects');
  const dm = objects.get(id);
  if (!dm || !(dm instanceof Y.Map)) return false;

  doc.transact(() => {
    dm.set('status', 'failed');
  }, UPLOAD_ORIGIN);

  return true;
}

function markRetrying(doc: Y.Doc, id: string): boolean {
  const UPLOAD_ORIGIN = Symbol('upload-origin');
  const objects = doc.getMap('objects');
  const dm = objects.get(id);
  if (!dm || !(dm instanceof Y.Map)) return false;

  doc.transact(() => {
    dm.set('status', 'uploading');
    dm.set('uploadStartedAt', Date.now());
  }, UPLOAD_ORIGIN);

  return true;
}
