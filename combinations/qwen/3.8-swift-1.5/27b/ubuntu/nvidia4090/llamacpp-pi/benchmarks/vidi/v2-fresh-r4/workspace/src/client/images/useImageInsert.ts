/**
 * Image insertion hook (story 12): drop, paste, picker flows.
 * Manages the in-memory file map for retry, progress tracking, and toasts.
 */
import { useCallback, useRef, useState, type DragEvent } from 'react';
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
  type Size,
} from '../../shared/objects/image';


interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** The viewport size (for centre computation). */
  viewportSize: { width: number; height: number };
  /** Show a toast message. */
  showToast(msg: string): void;
}

export interface UseImageInsertResult {
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: { target: EventTarget | null; clipboardData: DataTransfer | null; preventDefault(): void }): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** The hidden file input ref for the picker. */
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /** Handle the file input change event (for the picker). */
  handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void;
}

/**
 * Hook that handles all image insertion flows: drop, paste, and picker.
 * The caller must render the hidden file input and the DropHighlight.
 */
export function useImageInsert(args: UseImageInsertArgs): UseImageInsertResult {
  const { doc, boardId, camera, connection, identityId, viewportSize, showToast } = args;

  const [progress, setProgress] = useState<Map<string, number>>(new Map());
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const viewportRef = useRef(viewportSize);
  viewportRef.current = viewportSize;

  const isOnline = () => {
    const s = connectionRef.current;
    return s === 'connected' || s === 'confirmed';
  };

  const addFiles = useCallback(
    (files: File[], startPoint: Point, anchor: 'top-left' | 'centre') => {
      if (!isOnline()) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) {
        showToast(REJECTION_MESSAGES[r]);
      }

      if (accepted.length === 0) return;

      // Get natural dimensions via createImageBitmap
      const decodeAll = async () => {
        const items: { rect: { x: number; y: number; width: number; height: number }; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
        const sizes: Size[] = [];

        for (const file of accepted) {
          try {
            const bitmap = await createImageBitmap(file);
            const nw = bitmap.width;
            const nh = bitmap.height;
            bitmap.close();
            const ps = placementSize(nw, nh);
            sizes.push(ps);
            items.push({
              rect: { x: 0, y: 0, width: ps.width, height: ps.height },
              naturalWidth: nw,
              naturalHeight: nh,
              contentType: file.type,
            });
          } catch {
            // Decode failure → treat as type error
            showToast(REJECTION_MESSAGES.type);
            return;
          }
        }

        if (items.length === 0) return;

        const rects = layoutRow(sizes, startPoint, anchor);
        // Set actual positions
        for (let i = 0; i < items.length; i++) {
          items[i].rect = rects[i];
        }

        const ids = createImagePlaceholders(doc, items, identityId, Date.now());

        // Upload each file
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const file = accepted[i];
          fileMapRef.current.set(id, file);

          const handle = uploadImage(boardId, file, (fraction) => {
            setProgress((prev) => {
              const next = new Map(prev);
              next.set(id, fraction);
              return next;
            });
          });

          handle.promise.then((result) => {
            if (result.kind === 'ok') {
              markImageReady(doc, id, result.assetKey);
            } else {
              markImageFailed(doc, id);
            }
            setProgress((prev) => {
              const next = new Map(prev);
              next.delete(id);
              return next;
            });
          });
        }
      };

      void decodeAll();
    },
    [doc, boardId, identityId, showToast],
  );

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt || dt.files.length === 0) return;

      // Convert drop point to world coordinates
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const worldPoint = screenToWorld(cameraRef.current, screenPoint);

      addFiles([...dt.files], worldPoint, 'top-left');
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: { target: EventTarget | null; clipboardData: DataTransfer | null; preventDefault(): void }) => {
      // Ignore if focus is in a text editor
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const files = Array.from(e.clipboardData?.files ?? []).filter(
        (f) => f.type.startsWith('image/'),
      );
      if (files.length === 0) return;

      e.preventDefault();

      // Centre in the visible board area
      const centre = screenToWorld(cameraRef.current, {
        x: viewportRef.current.width / 2,
        y: viewportRef.current.height / 2,
      });

      addFiles(files, centre, 'centre');
    },
    [addFiles],
  );

  const openPicker = useCallback(() => {
    if (!isOnline()) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    fileInputRef.current?.click();
  }, [showToast]);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? [...e.target.files] : [];
      e.target.value = ''; // Reset so the same file can be picked again

      if (files.length === 0) return;

      const centre = screenToWorld(cameraRef.current, {
        x: viewportRef.current.width / 2,
        y: viewportRef.current.height / 2,
      });

      addFiles(files, centre, 'centre');
    },
    [addFiles],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = fileMapRef.current.get(id);
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
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
        setProgress((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      });

      return true;
    },
    [doc, boardId],
  );

  const canRetry = useCallback(
    (id: string): boolean => {
      return fileMapRef.current.has(id);
    },
    [],
  );

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    fileInputRef,
    handleFileInputChange: handleFileInput,
  };
}


