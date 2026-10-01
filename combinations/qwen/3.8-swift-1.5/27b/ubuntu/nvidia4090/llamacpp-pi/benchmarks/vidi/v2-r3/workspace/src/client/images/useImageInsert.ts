import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
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

interface UseImageInsertOpts {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Viewport size in screen pixels (for centring). */
  viewportSize: { width: number; height: number };
  showToast: (msg: string) => void;
}

export function useImageInsert(opts: UseImageInsertOpts) {
  const { doc, boardId, camera, connection, identityId, viewportSize, showToast } = opts;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dragActive, setDragActive] = useState(false);

  // In-memory map of id → File for retry
  const fileMapRef = useRef<Map<string, File>>(new Map());
  // Refs for stable callbacks
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const dragCounterRef = useRef(0);

  // Hidden file input for the picker
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOnline = useCallback(() => {
    const s = connectionRef.current;
    return s === 'connected' || s === 'confirmed';
  }, []);

  const addFilesClean = useCallback(
    async (files: File[], anchor: 'top-left' | 'centre', screenPoint?: Point) => {
      if (!isOnline()) {
        showToastRef.current(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) {
        showToastRef.current(REJECTION_MESSAGES[r]);
      }

      if (accepted.length === 0) return;

      // Measure each file's natural dimensions, keeping track of which file
      interface DecodedItem {
        file: File;
        naturalWidth: number;
        naturalHeight: number;
        contentType: string;
      }

      const decoded: DecodedItem[] = [];
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          const nw = bitmap.width;
          const nh = bitmap.height;
          bitmap.close();
          decoded.push({ file, naturalWidth: nw, naturalHeight: nh, contentType: file.type });
        } catch {
          showToastRef.current(REJECTION_MESSAGES.type);
        }
      }

      if (decoded.length === 0) return;

      // Compute placement sizes and layout
      const sizes = decoded.map((d) => placementSize(d.naturalWidth, d.naturalHeight));

      let start: Point;
      if (anchor === 'top-left' && screenPoint) {
        start = screenToWorld(cameraRef.current, screenPoint);
      } else {
        const centreScreen: Point = {
          x: viewportSizeRef.current.width / 2,
          y: viewportSizeRef.current.height / 2,
        };
        start = screenToWorld(cameraRef.current, centreScreen);
      }

      const rects = layoutRow(sizes, start, anchor);

      const now = Date.now();
      const items = decoded.map((d, i) => ({
        rect: rects[i],
        naturalWidth: d.naturalWidth,
        naturalHeight: d.naturalHeight,
        contentType: d.contentType,
      }));

      const ids = createImagePlaceholders(doc, items, identityId, now);

      // Upload each file
      ids.forEach((id, idx) => {
        const file = decoded[idx].file;
        fileMapRef.current.set(id, file);

        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, 0);
          return next;
        });

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
      });
    },
    [doc, boardId, identityId, isOnline],
  );

  // Minimal event type compatible with both native and React drag events
  interface DragEvt {
    preventDefault(): void;
    stopPropagation(): void;
    clientX: number;
    clientY: number;
    dataTransfer: DataTransfer | null;
  }

  // Drag and drop handlers
  const onDragEnter = useCallback((e: DragEvt) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) {
      dragCounterRef.current++;
      setDragActive(true);
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvt) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvt) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvt) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;

      const screenPoint: Point = { x: e.clientX, y: e.clientY };
      void addFilesClean(files, 'top-left', screenPoint);
    },
    [addFilesClean],
  );

  // Paste handler
  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // If focus is in a text editor, let the default paste happen
      const target = e.target as HTMLElement | null;
      if (target) {
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable
        ) {
          return; // Let the editor handle it
        }
      }

      const files = Array.from(e.clipboardData?.files || []);
      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      e.preventDefault();
      void addFilesClean(imageFiles, 'centre');
    },
    [addFilesClean],
  );

  // Register paste listener
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // Picker
  const openPicker = useCallback(() => {
    if (!isOnline()) {
      showToastRef.current(REJECTION_MESSAGES.offline);
      return;
    }

    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length === 0) return;
        void addFilesClean(files, 'centre');
      });
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    fileInputRef.current.click();
  }, [isOnline, addFilesClean]);

  // Retry
  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMapRef.current.get(id);
      if (!file) return false;

      markImageRetrying(doc, id, Date.now());

      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, 0);
        return next;
      });

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
    },
    [doc, boardId],
  );

  const canRetry = useCallback(
    (id: string): boolean => fileMapRef.current.has(id),
    [],
  );

  return {
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress,
    dragActive,
    retry,
    canRetry,
  };
}
