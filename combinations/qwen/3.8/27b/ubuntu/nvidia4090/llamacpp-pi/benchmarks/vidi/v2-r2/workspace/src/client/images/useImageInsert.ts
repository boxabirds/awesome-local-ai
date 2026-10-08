/**
 * Hook that handles adding images to the board (story 12, image.insert).
 *
 * Provides handlers for drag-and-drop, paste, and the Image tool picker.
 * Validates files, measures dimensions via createImageBitmap, creates
 * placeholders in the Y.Doc, and uploads with progress.
 *
 * Maintains an in-memory Map<id, File> for retry support.
 */

import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

/** The toast callback type. */
type ShowToast = (message: string) => void;

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** The viewport size (for centre placement). */
  viewportSize: { width: number; height: number };
  /** Show a toast message. */
  showToast: ShowToast;
}

export interface UseImageInsertResult {
  /** DragOver handler for the board viewport. */
  onDragOver(e: React.DragEvent): void;
  /** DragEnter handler for the board viewport. */
  onDragEnter(e: React.DragEvent): void;
  /** DragLeave handler for the board viewport. */
  onDragLeave(e: React.DragEvent): void;
  /** Drop handler for the board viewport. */
  onDrop(e: React.DragEvent): void;
  /** Paste handler (window-level). */
  onPaste(e: ClipboardEvent): void;
  /** Open the file picker (from the Image tool button or I shortcut). */
  openPicker(): void;
  /** Whether a file drag is currently over the board (for DropHighlight). */
  isDragging: boolean;
  /** Upload progress per image id (fraction 0..1). */
  progress: ReadonlyMap<string, number>;
  /** Retry a failed upload. Returns false if the file is no longer in memory. */
  retry(id: string): boolean;
  /** Whether the file for `id` is still in memory (can retry). */
  canRetry(id: string): boolean;
  /** The hidden file input ref (rendered by the Board). */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** Change handler for the hidden file input. */
  onFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void;
}

/**
 * Gets the natural dimensions of an image file using an <img> element.
 * More reliable than createImageBitmap for small/synthetic images.
 */
function getImageDimensions(file: File): Promise<{ nw: number; nh: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ nw: img.naturalWidth, nh: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    img.src = url;
  });
}

/**
 * Returns true when the event target is a text-editing element
 * (textarea, input, or contenteditable).
 */
function isEditingText(e: ClipboardEvent): boolean {
  const target = document.activeElement;
  if (target === null || target === undefined) {
    return false;
  }
  if (target instanceof HTMLElement) {
    return (
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'INPUT' ||
      target.isContentEditable
    );
  }
  return false;
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewportSize, showToast } = args;

  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const filesRef = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  /**
   * Core: process a batch of files — validate, decode, create placeholders,
   * and start uploads.
   */
  const processFiles = useCallback(
    async (files: File[], anchor: { point: Point; anchor: 'top-left' | 'centre' }) => {
      // Offline gate
      if (connectionRef.current !== 'connected' && connectionRef.current !== 'confirmed') {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);

      // Show toasts for rejections
      for (const r of rejections) {
        showToast(REJECTION_MESSAGES[r]);
      }

      if (accepted.length === 0) {
        return;
      }

      // Get natural dimensions for each accepted file
      const items: {
        rect: { x: number; y: number; width: number; height: number };
        naturalWidth: number;
        naturalHeight: number;
        contentType: string;
      }[] = [];

      for (const file of accepted) {
        try {
          const { nw, nh } = await getImageDimensions(file);
          const { width, height } = placementSize(nw, nh);
          items.push({
            rect: { x: 0, y: 0, width, height }, // positions set below
            naturalWidth: nw,
            naturalHeight: nh,
            contentType: file.type,
          });
        } catch {
          // Decode failure: treat as type rejection
          showToast(REJECTION_MESSAGES.type);
          continue;
        }
      }

      if (items.length === 0) {
        return;
      }

      // Layout the row
      const sizes = items.map((i) => ({ width: i.rect.width, height: i.rect.height }));
      const rects = layoutRow(sizes, anchor.point, anchor.anchor);

      // Assign positions
      for (let i = 0; i < items.length; i++) {
        items[i].rect = rects[i];
      }

      // Create placeholders (one undo step)
      const now = Date.now();
      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Start uploads in parallel
      const progressMap = new Map<string, number>();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const file = accepted[i];
        filesRef.current.set(id, file);
        progressMap.set(id, 0);

        const handle = uploadImage(boardId, file, (fraction) => {
          progressMap.set(id, fraction);
          setProgress(new Map(progressMap));
        });

        handle.promise.then((result) => {
          if (result.kind === 'ok') {
            markImageReady(doc, id, result.assetKey);
          } else {
            markImageFailed(doc, id);
          }
          // Clean up progress
          progressMap.delete(id);
          setProgress(new Map(progressMap));
        });
      }
    },
    [doc, boardId, identityId, showToast],
  );

  // --- Drop handlers ---

  const hasFiles = (e: React.DragEvent): boolean => {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  };

  const onDragOver = useCallback(
    (e: React.DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [],
  );

  const onDragEnter = useCallback(
    (e: React.DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDragging(true);
    },
    [],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent): void => {
      if (!hasFiles(e)) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    },
    [],
  );

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      const cam = cameraRef.current;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint: Point = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      const worldPoint = screenToWorld(cam, screenPoint);
      void processFiles(files, { point: worldPoint, anchor: 'top-left' });
    },
    [processFiles],
  );

  // --- Paste handler ---

  const onPaste = useCallback(
    (e: ClipboardEvent): void => {
      // If a text editor has focus, let the paste go through normally
      if (isEditingText(e)) return;

      const items = e.clipboardData?.items;
      if (items === undefined) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file !== null) {
            files.push(file);
          }
        }
      }

      if (files.length === 0) return;

      e.preventDefault();

      const cam = cameraRef.current;
      const vs = viewportSizeRef.current;
      const screenCentre: Point = { x: vs.width / 2, y: vs.height / 2 };
      const worldCentre = screenToWorld(cam, screenCentre);
      void processFiles(files, { point: worldCentre, anchor: 'centre' });
    },
    [processFiles],
  );

  // --- Picker ---

  const openPicker = useCallback((): void => {
    // Offline gate
    if (connectionRef.current !== 'connected' && connectionRef.current !== 'confirmed') {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [showToast]);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      // Reset after processing (not immediately, to avoid File invalidation)
      setTimeout(() => { e.target.value = ''; }, 1000);
      const cam = cameraRef.current;
      const vs = viewportSizeRef.current;
      const screenCentre: Point = { x: vs.width / 2, y: vs.height / 2 };
      const worldCentre = screenToWorld(cam, screenCentre);
      void processFiles(files, { point: worldCentre, anchor: 'centre' });
    },
    [processFiles],
  );

  // --- Retry ---

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false;

      markImageRetrying(doc, id, Date.now());

      const progressMap = new Map(progress);
      progressMap.set(id, 0);
      setProgress(progressMap);

      const handle = uploadImage(boardId, file, (fraction) => {
        progressMap.set(id, fraction);
        setProgress(new Map(progressMap));
      });

      handle.promise.then((result) => {
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
        progressMap.delete(id);
        setProgress(new Map(progressMap));
      });

      return true;
    },
    [doc, boardId, progress],
  );

  const canRetry = useCallback(
    (id: string): boolean => {
      return filesRef.current.has(id);
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
    isDragging,
    progress,
    retry,
    canRetry,
    fileInputRef,
    onFileInputChange,
  };
}
