/**
 * Story 12 (image.insert): drop, paste and picker flows for adding images.
 *
 * All three entries funnel through `insertFiles`:
 *   1. offline gate (connection not connected/confirmed → offline toast),
 *   2. validateFiles (type / size / count → toasts with the exact PRD copy),
 *   3. createImageBitmap for the natural size (decode failure → type toast),
 *   4. createImagePlaceholders — one LOCAL_ORIGIN transaction (one undo step),
 *   5. one XHR upload per file; ok → markImageReady, failure → markImageFailed
 *      (both UPLOAD_ORIGIN — never undo steps).
 *
 * The uploader keeps the File in memory per object id so Retry can re-upload
 * it; after a page reload the file is gone and only Remove is offered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { ConnectionState } from '../sync/connectBoard';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage, type UploadHandle } from './uploadImage';
import type { ToastMessage } from '../ui/Toast';

const TOAST_TTL_MS = 4000;
const ONLINE: ReadonlySet<ConnectionState> = new Set<ConnectionState>(['connected', 'confirmed']);

export interface ImageInsertApi {
  /** Drag handlers for the board root (file drags only). */
  onDragOver(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onDragEnter(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  /** Whether the drop highlight should be shown. */
  readonly dragActive: boolean;
  /** Opens the system file picker (offline → toast, no picker). */
  openPicker(): void;
  /** Picker <input> change handler (tests may call it directly). */
  handlePickerFiles(files: FileList | null): void;
  /** Upload progress by object id (uploader only, 0..1). */
  readonly progress: ReadonlyMap<string, number>;
  /** Re-upload a failed image (file still in memory). True when started. */
  retry(id: string): boolean;
  /** Whether Retry is offered for this id (file still in memory). */
  canRetry(id: string): boolean;
  /** Drop the in-memory file for an id (Remove / ready). */
  forget(id: string): void;
  /** Current toasts (bottom of screen, role=status). */
  readonly toasts: readonly ToastMessage[];
}

interface Measured {
  file: File;
  naturalWidth: number;
  naturalHeight: number;
}

export function useImageInsert(args: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewSize: Size;
  connection: ConnectionState;
  identityId: string;
  editable: boolean;
  /** Undo step boundary (story 8): one boundary around the placeholder batch. */
  boundary(): void;
}): ImageInsertApi {
  const { doc, boardId, identityId } = args;

  // Latest-value refs: the window-level listeners are registered once.
  const cameraRef = useRef(args.camera);
  cameraRef.current = args.camera;
  const viewSizeRef = useRef(args.viewSize);
  viewSizeRef.current = args.viewSize;
  const connectionRef = useRef(args.connection);
  connectionRef.current = args.connection;
  const editableRef = useRef(args.editable);
  editableRef.current = args.editable;
  const boundaryRef = useRef(args.boundary);
  boundaryRef.current = args.boundary;

  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const toastId = useRef(0);
  const dragDepth = useRef(0);

  // The in-memory retry map (object id → File). Lost on reload by design.
  const filesRef = useRef(new Map<string, File>());
  // Live XHR handles, so an unmount can abort in-flight uploads.
  const handlesRef = useRef(new Map<string, UploadHandle>());

  const pushToast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-2), { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      filesRef.current.set(id, file);
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(id, 0);
        return next;
      });
      const handle = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(id, fraction);
          return next;
        });
      });
      handlesRef.current.set(id, handle);
      void handle.promise.then((result) => {
        handlesRef.current.delete(id);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
          filesRef.current.delete(id);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [boardId, doc],
  );

  const insertFiles = useCallback(
    async (files: readonly File[], anchor: Point, mode: 'top-left' | 'centre') => {
      if (!editableRef.current) return; // load_failed: the board is not editable
      if (!ONLINE.has(connectionRef.current)) {
        pushToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const r of rejections) pushToast(REJECTION_MESSAGES[r]);
      if (accepted.length === 0) return;

      // Natural size via decode; a file that cannot be decoded is treated as
      // an unsupported type (TC-29: corrupt image → type toast, no placeholder).
      const measured: Measured[] = [];
      let decodeFailures = 0;
      for (const file of accepted) {
        try {
          const bmp = await createImageBitmap(file);
          measured.push({ file, naturalWidth: bmp.width, naturalHeight: bmp.height });
          bmp.close();
        } catch {
          decodeFailures += 1;
        }
      }
      if (decodeFailures > 0) pushToast(REJECTION_MESSAGES.type);
      if (measured.length === 0) return;

      const sizes = measured.map((m) => placementSize(m.naturalWidth, m.naturalHeight));
      const rects = layoutRow(sizes, anchor, mode);
      boundaryRef.current();
      const ids = createImagePlaceholders(
        doc,
        measured.map((m, i) => ({
          rect: rects[i],
          naturalWidth: m.naturalWidth,
          naturalHeight: m.naturalHeight,
          contentType: m.file.type || 'image/png',
        })),
        identityId,
        Date.now(),
      );
      boundaryRef.current();
      measured.forEach((m, i) => {
        const id = ids[i];
        if (id) startUpload(id, m.file);
      });
    },
    [doc, identityId, pushToast, startUpload],
  );

  /* ----------------------------- drop ----------------------------- */

  const hasFiles = (e: DragEvent): boolean =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    // Required to allow the drop and to show the copy indicator.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      // The board root is fixed at (0,0), so client coords are board-local.
      void insertFiles(files, screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY }), 'top-left');
    },
    [insertFiles],
  );

  /* ----------------------------- paste ---------------------------- */

  const viewCentre = useCallback((): Point => {
    const s = viewSizeRef.current;
    return screenToWorld(cameraRef.current, { x: s.width / 2, y: s.height / 2 });
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // Pasting into a text editor / field: leave it alone, no image.
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }
      // Only image files count for paste; any other clipboard content is
      // ignored (no toast) per the paste sequence.
      const files = Array.from(e.clipboardData?.files ?? []).filter(
        (f) => (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(f.type),
      );
      if (files.length === 0) return;
      e.preventDefault();
      void insertFiles(files, viewCentre(), 'centre');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [insertFiles, viewCentre]);

  /* ----------------------------- picker --------------------------- */

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = (IMAGE_ACCEPTED_TYPES as readonly string[]).join(',');
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => {
      handlePickerFilesRef.current(input.files);
      input.value = ''; // allow re-picking the same file
    });
    document.body.appendChild(input);
    inputRef.current = input;
    return () => {
      document.body.removeChild(input);
      inputRef.current = null;
    };
  }, []);

  const handlePickerFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return; // picker cancelled
      void insertFiles(Array.from(files), viewCentre(), 'centre');
    },
    [insertFiles, viewCentre],
  );
  const handlePickerFilesRef = useRef(handlePickerFiles);
  handlePickerFilesRef.current = handlePickerFiles;

  const openPicker = useCallback(() => {
    if (!editableRef.current) return;
    if (!ONLINE.has(connectionRef.current)) {
      pushToast(REJECTION_MESSAGES.offline);
      return;
    }
    inputRef.current?.click();
  }, [pushToast]);

  /* --------------------------- retry/remove ----------------------- */

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      if (!markImageRetrying(doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  const canRetry = useCallback(
    (id: string): boolean => filesRef.current.has(id),
    // Re-evaluated on doc-driven re-renders; the map itself is a ref.
    [],
  );

  const forget = useCallback((id: string): void => {
    filesRef.current.delete(id);
    handlesRef.current.get(id)?.abort();
    handlesRef.current.delete(id);
    setProgress((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Abort in-flight uploads on unmount.
  useEffect(() => {
    const handles = handlesRef.current;
    return () => {
      for (const h of handles.values()) h.abort();
    };
  }, []);

  return {
    onDragOver,
    onDrop,
    onDragEnter,
    onDragLeave,
    dragActive,
    openPicker,
    handlePickerFiles,
    progress,
    retry,
    canRetry,
    forget,
    toasts,
  };
}
