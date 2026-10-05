/**
 * Image insertion hook (story 12).
 * Handles drop, paste, and picker flows; validates files; creates placeholders;
 * uploads with progress; supports retry.
 */
import { useCallback, useRef, useState, useEffect } from 'react';
import type * as Y from 'yjs';
import type { ConnectionState } from '../sync/connectBoard';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { validateFiles, REJECTION_MESSAGES, type FileRejection } from './validateFiles';
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
import { useToast } from '../ui/Toast';

interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
}

/**
 * Check if the event target is a text input, textarea, or contenteditable.
 */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

export function useImageInsert(args: UseImageInsertArgs) {
  const { doc, boardId, camera, connection, identityId } = args;
  const { messages, showToast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // In-memory map of image id → File for retry support
  const fileMapRef = useRef<Map<string, File>>(new Map());
  // Progress map: image id → fraction (0-1)
  const [progress, setProgress] = useState<Map<string, number>>(new Map());

  // Camera ref for stable access in callbacks
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const isConnected = connection === 'connected' || connection === 'confirmed';

  /**
   * Show rejection toasts for the given set of rejection reasons.
   */
  const showRejections = useCallback((rejections: Set<FileRejection>) => {
    for (const reason of rejections) {
      showToast(REJECTION_MESSAGES[reason]);
    }
  }, [showToast]);

  /**
   * Core: validate files, create placeholders, and start uploads.
   */
  const addFiles = useCallback(async (files: File[], anchor: 'top-left' | 'centre', anchorPoint: { x: number; y: number }) => {
    // Offline gate
    if (!isConnected) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    const { accepted, rejections } = validateFiles(files);
    if (rejections.size > 0) {
      showRejections(rejections);
    }
    if (accepted.length === 0) return;

    // Get natural sizes via createImageBitmap
    const sizedItems: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string; file: File }[] = [];
    let decodeFailures = 0;

    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = placementSize(bitmap.width, bitmap.height);
        sizedItems.push({
          rect: { x: 0, y: 0, width, height },
          naturalWidth: bitmap.width,
          naturalHeight: bitmap.height,
          contentType: file.type,
          file,
        });
        bitmap.close();
      } catch {
        decodeFailures++;
      }
    }

    if (decodeFailures > 0) {
      showToast(REJECTION_MESSAGES.type);
    }
    if (sizedItems.length === 0) return;

    // Layout the row
    const sizes = sizedItems.map((item) => ({ width: item.rect.width, height: item.rect.height }));
    const rects = layoutRow(sizes, anchorPoint, anchor);

    // Create placeholders in one transaction
    const items = sizedItems.map((item, i) => ({
      rect: rects[i],
      naturalWidth: item.naturalWidth,
      naturalHeight: item.naturalHeight,
      contentType: item.contentType,
    }));
    const ids = createImagePlaceholders(doc, items, identityId, Date.now());

    // Store files for retry
    for (let i = 0; i < ids.length; i++) {
      fileMapRef.current.set(ids[i], sizedItems[i].file);
    }

    // Start uploads in parallel
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = sizedItems[i].file;

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
    }
  }, [doc, boardId, identityId, isConnected, showRejections, showToast]);

  // ─── Drag and drop ──────────────────────────────────────────────────────────

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounterRef.current++;
      setIsDragging(true);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    // Convert drop point to world coordinates
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPoint = screenToWorld(cameraRef.current, screenPoint);

    void addFiles(files, 'top-left', worldPoint);
  }, [addFiles]);

  // ─── Paste ──────────────────────────────────────────────────────────────────

  const onPaste = useCallback((e: ClipboardEvent) => {
    // Ignore if focus is in a text editor
    if (isEditingText(e.target)) return;

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

    e.preventDefault();

    // Centre in visible area
    const cam = cameraRef.current;
    const viewCentre = {
      x: cam.x + window.innerWidth / (2 * cam.zoom),
      y: cam.y + window.innerHeight / (2 * cam.zoom),
    };

    void addFiles(imageFiles, 'centre', viewCentre);
  }, [addFiles]);

  // Attach paste listener
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // ─── Picker ─────────────────────────────────────────────────────────────────

  const openPicker = useCallback(() => {
    // Offline gate
    if (!isConnected) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }

    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = (IMAGE_ACCEPTED_TYPES as readonly string[]).join(',');
      input.style.display = 'none';
      input.setAttribute('data-testid', 'image-file-input');
      document.body.appendChild(input);
      fileInputRef.current = input;
    }

    const input = fileInputRef.current;
    input.value = ''; // Reset so the same file can be re-selected

    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;

      // Centre in visible area
      const cam = cameraRef.current;
      const viewCentre = {
        x: cam.x + window.innerWidth / (2 * cam.zoom),
        y: cam.y + window.innerHeight / (2 * cam.zoom),
      };

      void addFiles(files, 'centre', viewCentre);
    };

    input.click();
  }, [isConnected, addFiles, showToast]);

  // ─── Retry ──────────────────────────────────────────────────────────────────

  const retry = useCallback((id: string): boolean => {
    const file = fileMapRef.current.get(id);
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
  }, [doc, boardId]);

  const canRetry = useCallback((id: string): boolean => {
    return fileMapRef.current.has(id);
  }, []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    isDragging,
    openPicker,
    progress,
    retry,
    canRetry,
    messages,
  };
}
