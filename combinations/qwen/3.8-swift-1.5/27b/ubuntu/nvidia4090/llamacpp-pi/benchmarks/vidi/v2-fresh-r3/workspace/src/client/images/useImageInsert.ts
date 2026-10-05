import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  layoutRow,
} from '../../shared/objects/image';
import { deleteObjects } from '../../shared/board-model';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';

/**
 * Adding images (story 12, image.insert): drop, paste and picker flows.
 *
 * - Offline gate: while the connection is not `connected`/`confirmed` nothing
 *   is added and the offline message is shown (drop, paste and picker alike).
 * - validateFiles applies the type/size/count limits with the exact PRD
 *   toasts; natural dimensions come from createImageBitmap (a decode failure
 *   is reported as a type message and the file is skipped).
 * - Placeholders are created in one transaction (one undo step) at their
 *   final size and position; uploads run in parallel with XHR progress in
 *   the `progress` map; ok → markImageReady, failed → markImageFailed.
 * - The in-memory `filesRef` (id → File) powers Retry and is lost on reload
 *   by design (after a reload only Remove is offered).
 */

const TOAST_VISIBLE_MS = 4000;

export interface ImageInsert {
  /** Drag handlers for the board viewport (file drags only). */
  onDragOver(e: ReactDragEvent): void;
  onDragEnter(e: ReactDragEvent): void;
  onDragLeave(e: ReactDragEvent): void;
  onDrop(e: ReactDragEvent): void;
  /** True while files are dragged over the board (drop highlight). */
  dropHighlight: boolean;
  /** Opens the system file picker (Image button / I key). */
  openPicker(): void;
  /** Upload progress per image id (uploader only), 0..1. */
  progress: ReadonlyMap<string, number>;
  /** Retries a failed upload while its file is still in memory. */
  retry(id: string): boolean;
  /** True while the failed upload's file is still in memory. */
  canRetry(id: string): boolean;
  /** Toast messages to render (role=status). */
  toasts: readonly string[];
}

export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
}): ImageInsert {
  const { doc, boardId, identityId } = a;
  const cameraRef = useRef(a.camera);
  cameraRef.current = a.camera;
  const connectionRef = useRef(a.connection);
  connectionRef.current = a.connection;

  const filesRef = useRef(new Map<string, File>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dropHighlight, setDropHighlight] = useState(false);
  const dragDepth = useRef(0);

  // --- toasts -------------------------------------------------------------
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_VISIBLE_MS);
  }, []);

  const isOnline = () => {
    const s = connectionRef.current;
    return s === 'connected' || s === 'confirmed';
  };

  // --- uploads -------------------------------------------------------------
  const startUpload = useCallback(
    (id: string, file: File) => {
      const upload = uploadImage(boardId, file, (fraction) => {
        setProgress((p) => new Map(p).set(id, fraction));
      });
      void upload.promise.then((result) => {
        setProgress((p) => {
          const next = new Map(p);
          next.delete(id);
          return next;
        });
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [boardId, doc],
  );

  /** Validates, measures, places (one undo step) and uploads a batch. */
  const addFiles = useCallback(
    async (files: File[], anchor: 'top-left' | 'centre', at?: Point) => {
      if (!isOnline()) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const r of [...rejections].sort()) {
        showToast(REJECTION_MESSAGES[r]);
      }
      if (accepted.length === 0) return;

      // Natural dimensions via createImageBitmap; a decode failure is
      // reported as a type message and the file is skipped.
      const measured: { file: File; width: number; height: number }[] = [];
      let decodeFailed = false;
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          measured.push({ file, width: bitmap.width, height: bitmap.height });
          bitmap.close?.();
        } catch {
          decodeFailed = true;
        }
      }
      if (decodeFailed) showToast(REJECTION_MESSAGES.type);
      if (measured.length === 0) return;

      const sizes = measured.map((m) => placementSize(m.width, m.height));
      const centre = screenToWorld(cameraRef.current, {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const point = at ?? centre;
      const rects = layoutRow(sizes, point, anchor);
      const now = Date.now();
      const ids = createImagePlaceholders(
        doc,
        measured.map((m, i) => ({
          rect: rects[i],
          naturalWidth: m.width,
          naturalHeight: m.height,
          contentType: m.file.type,
        })),
        identityId,
        now,
      );
      measured.forEach((m, i) => {
        const id = ids[i];
        if (!id) return;
        filesRef.current.set(id, m.file);
        startUpload(id, m.file);
      });
    },
    [doc, identityId, showToast, startUpload],
  );

  // --- drop ----------------------------------------------------------------
  const isFileDrag = (e: ReactDragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropHighlight(true);
  }, []);

  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropHighlight(false);
  }, []);

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDropHighlight(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      // The viewport is fixed inset 0, so client coordinates are viewport
      // coordinates.
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      void addFiles(files, 'top-left', world);
    },
    [addFiles],
  );

  // --- paste ----------------------------------------------------------------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Pasting while a text editor has focus keeps its default behaviour.
      const target = document.activeElement;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      e.preventDefault();
      void addFiles(files, 'centre');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // --- picker ----------------------------------------------------------------
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openPicker = useCallback(() => {
    if (!isOnline()) {
      showToast(REJECTION_MESSAGES.offline);
      return; // the picker is not opened while offline
    }
    if (!inputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.style.display = 'none';
      input.setAttribute('data-testid', 'image-file-input');
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length > 0) void addFiles(files, 'centre');
      });
      document.body.appendChild(input);
      inputRef.current = input;
    }
    inputRef.current.click();
  }, [addFiles, showToast]);

  useEffect(() => {
    return () => {
      inputRef.current?.remove();
      inputRef.current = null;
    };
  }, []);

  // --- retry ------------------------------------------------------------------
  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  const canRetry = useCallback((id: string) => filesRef.current.has(id), []);

  return {
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    dropHighlight,
    openPicker,
    progress,
    retry,
    canRetry,
    toasts: toasts.map((t) => t.message),
  };
}

// ---------------------------------------------------------------------------
// Context for object components (image.object): the uploader identity,
// progress, retry and removal are board-level concerns.
// ---------------------------------------------------------------------------

export interface ImageInsertContextValue {
  doc: Y.Doc;
  identityId: string;
  progress: ReadonlyMap<string, number>;
  canRetry(id: string): boolean;
  retry(id: string): boolean;
  /** Removes an image placeholder (story 7 deleteObjects, one undo step). */
  onRemoveImage(id: string): void;
}

export const ImageInsertContext = createContext<ImageInsertContextValue | null>(null);

export function useImageContext(): ImageInsertContextValue {
  const ctx = useContext(ImageInsertContext);
  if (!ctx) throw new Error('useImageContext must be used inside ImageInsertContext.Provider');
  return ctx;
}

/** Removes an image object with an undo boundary (story 7). */
export function makeRemoveImage(
  doc: Y.Doc,
  onBoundary: () => void,
): (id: string) => void {
  return (id: string) => {
    onBoundary();
    deleteObjects(doc, [id]);
    onBoundary();
  };
}
