/**
 * Story 12 — Hook for inserting images via drop, paste, or picker.
 */
import { useCallback, useRef, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  placementSize,
  layoutRow,
  createImagePlaceholders,
  markImageReady,
  markImageFailed,
  markImageRetrying,
} from '@/shared/objects/image';
import type { Camera } from '@/client/canvas/camera';
import type { ConnectionState } from '@/client/sync/connectBoard';
import { showToast } from '@/client/ui/Toast';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
}

type ProgressMap = ReadonlyMap<string, number>;

interface RetryEntry {
  id: string;
  file: File;
}

interface UseImageInsertReturn {
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ProgressMap;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

/** Check if focus is in a text-editing element */
function isFocusInTextInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  if (el.getAttribute('contenteditable') === 'true') return true;
  // Also check ancestors
  let node = el.parentElement;
  while (node) {
    const nTag = node.tagName?.toLowerCase();
    if (nTag === 'input' || nTag === 'textarea') return true;
    if (node.getAttribute('contenteditable') === 'true') return true;
    if (node.tagName?.toLowerCase() === 'body') break;
    node = node.parentElement;
  }
  return false;
}

export function useImageInsert({
  doc,
  boardId,
  camera,
  connection,
  identityId,
}: UseImageInsertArgs): UseImageInsertReturn {
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const retryFilesRef = useRef<Map<string, File>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Helper to add images from files at a given world point or centred in view
  const addImagesFromFiles = useCallback(
    async (
      files: File[],
      anchorX: number,
      anchorY: number,
      anchor: 'top-left' | 'centre',
    ) => {
      const result = validateFiles(files);
      const { accepted, rejections } = result;

      // Show rejection messages
      if (rejections.has('type')) {
        showToast(REJECTION_MESSAGES.type);
      }
      if (rejections.has('size')) {
        showToast(REJECTION_MESSAGES.size);
      }
      if (rejections.has('count')) {
        showToast(REJECTION_MESSAGES.count);
      }

      if (accepted.length === 0) return;

      // Measure natural dimensions for accepted files
      const sizes: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
      const bitmaps: ImageBitmap[] = [];

      try {
        for (const file of accepted) {
          const bitmap = await createImageBitmap(file);
          bitmaps.push(bitmap);
          const place = placementSize(bitmap.width, bitmap.height);
          sizes.push({
            rect: { x: 0, y: 0, width: place.width, height: place.height },
            naturalWidth: bitmap.width,
            naturalHeight: bitmap.height,
            contentType: file.type,
          });
        }
      } catch {
        // If any bitmap decode fails, show type message and skip failed files
        showToast(REJECTION_MESSAGES.type);
        bitmaps.forEach(b => b.close());
        return;
      }

      // Layout all items
      const rects = layoutRow(sizes.map(s => ({ width: s.rect.width, height: s.rect.height })), { x: anchorX, y: anchorY }, anchor);

      // Create placeholders
      const now = Date.now();
      const placeholderItems = rects.map((r, i) => ({
        rect: r,
        naturalWidth: sizes[i].naturalWidth,
        naturalHeight: sizes[i].naturalHeight,
        contentType: sizes[i].contentType,
      }));
      const ids = createImagePlaceholders(doc, placeholderItems, identityId, now);

      // Build progress map
      const initialProgress = new Map<string, number>();
      for (const id of ids) {
        initialProgress.set(id, 0);
      }
      setProgressMap(new Map(initialProgress));

      // Upload each image
      const uploads: Promise<void>[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const file = accepted[i];

        // Store for retry
        retryFilesRef.current.set(id, file);

        const handle = uploadImage(boardId, file, (fraction) => {
          setProgressMap(prev => {
            const next = new Map(prev);
            next.set(id, Math.round(fraction * 100));
            return next;
          });
        });

        const p = handle.promise.then((res) => {
          if (res.kind === 'ok') {
            markImageReady(doc, id, res.assetKey);
          } else {
            markImageFailed(doc, id);
          }
          // Remove from progress after completion
          setProgressMap(prev => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        }).catch(() => {
          markImageFailed(doc, id);
          setProgressMap(prev => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          });
        });

        uploads.push(p);
      }

      // Clean up bitmaps
      for (const b of bitmaps) {
        b.close();
      }

      await Promise.all(uploads);
    },
    [doc, boardId, identityId],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    // Only highlight for file drags (not links/text)
    const hasFiles = Array.from(e.dataTransfer?.types || []).includes('Files');
    if (hasFiles) {
      e.dataTransfer!.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();

      // Check connection
      if (connection !== 'connected' && connection !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;

      // Convert drop point to world coordinates
      const target = e.target as HTMLElement;
      const svgEl = target.closest('svg') || target.closest('[data-layer="world"]')?.closest('svg');
      const rect = svgEl?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const cam = camera;
      const worldX = (screenX + cam.x) / cam.zoom;
      const worldY = (screenY + cam.y) / cam.zoom;

      addImagesFromFiles(Array.from(dt.files), worldX, worldY, 'top-left');
    },
    [camera, connection, addImagesFromFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // If editing text, let it pass through
      if (isFocusInTextInput()) return;

      // Check connection
      if (connection !== 'connected' && connection !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) return;

      // Centre in view
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const cam = camera;
      const viewCentreX = vw / cam.zoom + cam.x - (typeof window !== 'undefined' ? vw / cam.zoom : 1280) / 2;
      const viewCentreY = vh / cam.zoom + cam.y - (typeof window !== 'undefined' ? vh / cam.zoom : 800) / 2;

      addImagesFromFiles(imageFiles, viewCentreX, viewCentreY, 'centre');
    },
    [camera, connection, addImagesFromFiles],
  );

  const openPicker = useCallback(() => {
    // Check connection
    if (connection !== 'connected' && connection !== 'confirmed') {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].join(',');

    input.addEventListener('change', () => {
      if (!input.files || input.files.length === 0) return;
      if (connection !== 'connected' && connection !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      // Centre in view
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const cam = camera;
      const viewCentreX = vw / cam.zoom + cam.x - (typeof window !== 'undefined' ? vw / cam.zoom : 1280) / 2;
      const viewCentreY = vh / cam.zoom + cam.y - (typeof window !== 'undefined' ? vh / cam.zoom : 800) / 2;

      addImagesFromFiles(Array.from(input.files), viewCentreX, viewCentreY, 'centre');

      // Cleanup
      input.remove();
    });

    input.click();
  }, [camera, connection, addImagesFromFiles]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = retryFilesRef.current.get(id);
      if (!file) return false;

      markImageRetrying(doc, id, Date.now());

      const handle = uploadImage(boardId, file, (fraction) => {
        setProgressMap(prev => {
          const next = new Map(prev);
          next.set(id, Math.round(fraction * 100));
          return next;
        });
      });

      handle.promise.then((res) => {
        if (res.kind === 'ok') {
          markImageReady(doc, id, res.assetKey);
        } else {
          markImageFailed(doc, id);
        }
        setProgressMap(prev => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });

      return true;
    },
    [doc, boardId],
  );

  const canRetry = useCallback((id: string): boolean => {
    return retryFilesRef.current.has(id);
  }, []);

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress: useMemo(() => progressMap, [progressMap]),
    retry,
    canRetry,
  };
}
