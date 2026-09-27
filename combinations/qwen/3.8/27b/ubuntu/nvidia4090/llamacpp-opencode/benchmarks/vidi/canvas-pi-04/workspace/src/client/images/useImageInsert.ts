// Story 12: the image-insertion hook (anchor: image.insert / image.drop /
// image.paste / image.pick).
//
// One hook drives all three entry points (drag-and-drop, paste, file picker)
// and shares the same validation → placeholder → upload flow:
//   1. Offline before start → offline toast, nothing added (image.offline).
//   2. validateFiles (type/size/count) → toasts for each rejection class.
//   3. Read each file's natural size (createImageBitmap); a decode failure is a
//      type rejection (no placeholder; TC-29).
//   4. layoutRow at the drop point (top-left) or the view centre (paste/pick),
//      then createImagePlaceholders — ONE local transaction, one undo step.
//   5. Upload each with XHR progress (local, not shared); ready/failed use the
//      untracked UPLOAD_ORIGIN so completion is never its own undo step.
//
// The in-memory id→File map (filesRef) is what makes Retry possible: after a
// reload the map is empty, so ImageObject offers only Remove (TC-24).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import type * as Y from 'yjs';
import type { Point } from '../../shared/geometry';
import { deleteObjects } from '../../shared/board-model';
import type { ConnectionState } from '../sync/connectBoard';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage } from './uploadImage';
import { readImageSize } from './readImageSize';
import { useToasts, type ToastItem } from '../ui/Toast';
import type { ImageUploadApi } from './ImageUploadContext';

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  viewport: { width: number; height: number };
  identityId: string;
  canEdit: boolean;
  undo: UndoController | null;
  /**
   * The board's connection state (story 3). Adding images requires a live
   * connection: while the board is not `connected`/`confirmed` (connecting,
   * reconnecting, load_failed) no upload is started (image.offline).
   */
  connection: ConnectionState;
}

export interface UseImageInsert {
  /** True while files are dragged over the board (drives the highlight). */
  isDragActive: boolean;
  toasts: readonly ToastItem[];
  /** The per-image upload API to provide via ImageUploadContext. */
  uploadApi: ImageUploadApi;
  /** Open the hidden file picker (Image button / I shortcut). */
  openPicker(): void;
  onInputChange(e: ChangeEvent<HTMLInputElement>): void;
  /** Paste handler (also attached to `window` internally). */
  onPaste(e: ClipboardEvent): void;
  /** Window-level drag/drop handlers for the board root. */
  dropHandlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  /** Upload progress per object id (0..1), uploader-side only. */
  progress: ReadonlyMap<string, number>;
  /** Re-upload a failed image; true when the file was still in memory. */
  retry(id: string): boolean;
  /** True when a retry of `id` is possible (file not lost to a reload). */
  canRetry(id: string): boolean;
  /** The accept string for the hidden file input. */
  accept: string;
  /** Ref for the hidden file input the caller renders. */
  pickerRef: RefObject<HTMLInputElement | null>;
}

const VIEWPORT_TESTID = 'board-viewport';

export function useImageInsert(args: UseImageInsertArgs): UseImageInsert {
  const { doc, boardId, camera, viewport, identityId, canEdit, undo, connection } = args;

  // Latest values for the async flow and window listeners.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const docRef = useRef(doc);
  docRef.current = doc;

  // Adding images requires a live board connection (image.offline).
  const isConnected = (): boolean =>
    connectionRef.current === 'connected' || connectionRef.current === 'confirmed';

  const [isDragActive, setIsDragActive] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const { toasts, push } = useToasts();
  // In-memory id → File (Retry source); empty after a reload.
  const filesRef = useRef(new Map<string, File>());
  const dragDepthRef = useRef(0);
  const pickerRef = useRef<HTMLInputElement | null>(null);

  const clearProgress = useCallback((id: string): void => {
    setProgress((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Start (or restart) an upload for an existing placeholder.
  const beginUpload = useCallback(
    (id: string, file: File, fresh: boolean): void => {
      if (fresh) markImageRetrying(docRef.current, id, Date.now());
      filesRef.current.set(id, file);
      const handle = uploadImage(boardId, file, (fraction) => {
        setProgress((prev) => ({ ...prev, [id]: fraction }));
      });
      void handle.promise.then((result) => {
        if (result.kind === 'ok') {
          markImageReady(docRef.current, id, result.assetKey);
          filesRef.current.delete(id);
          clearProgress(id);
        } else {
          markImageFailed(docRef.current, id);
          if (result.kind === 'rate_limited') push(REJECTION_MESSAGES.rate);
          // Keep the file so Retry is still offered (TC-24).
          clearProgress(id);
        }
      });
    },
    [boardId, clearProgress, push],
  );

  // The shared insert flow for drop / paste / picker.
  const handleFiles = useCallback(
    async (fileList: FileList | File[], source: 'drop' | 'paste' | 'pick', at?: Point): Promise<void> => {
      if (!canEditRef.current) return; // load_failed: nothing is added
      const files = Array.from(fileList);
      if (files.length === 0) return;

      // Offline or reconnecting before start (image.offline): nothing is
      // added and no upload starts while the board is not connected.
      if (!isConnected()) {
        push(REJECTION_MESSAGES.offline);
        return;
      }

      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections) push(REJECTION_MESSAGES[reason]);
      if (accepted.length === 0) return;

      // Natural size per file; a decode failure is a type rejection (TC-29).
      const entries: { file: File; naturalWidth: number; naturalHeight: number; contentType: string }[] = [];
      for (const file of accepted) {
        try {
          const size = await readImageSize(file);
          entries.push({
            file,
            naturalWidth: size.width,
            naturalHeight: size.height,
            contentType: file.type,
          });
        } catch {
          push(REJECTION_MESSAGES.type);
        }
      }
      if (entries.length === 0) return;

      // Anchor: the drop point for a drop, otherwise the view centre.
      const anchorPoint: Point =
        at ??
        screenToWorld(cameraRef.current, {
          x: viewportRef.current.width / 2,
          y: viewportRef.current.height / 2,
        });
      const anchor = source === 'drop' ? 'top-left' : 'centre';
      const sizes = entries.map((e) => placementSize(e.naturalWidth, e.naturalHeight));
      const rects = layoutRow(sizes, anchorPoint, anchor);

      const d = docRef.current;
      const now = Date.now();
      undoRef.current?.boundary();
      const ids = createImagePlaceholders(
        d,
        entries.map((e, i) => ({
          rect: rects[i]!,
          naturalWidth: e.naturalWidth,
          naturalHeight: e.naturalHeight,
          contentType: e.contentType,
        })),
        identityId,
        now,
      );
      undoRef.current?.boundary();

      ids.forEach((id, i) => beginUpload(id, entries[i]!.file, false));
    },
    [boardId, identityId, beginUpload, push],
  );

  // Viewport-local world point for a client coordinate (pen/shape pattern).
  const dropPoint = useCallback((clientX: number, clientY: number): Point | undefined => {
    const root = document.querySelector(`[data-testid="${VIEWPORT_TESTID}"]`);
    if (root === null) return undefined;
    const rect = root.getBoundingClientRect();
    return screenToWorld(cameraRef.current, { x: clientX - rect.left, y: clientY - rect.top });
  }, []);

  // Paste (image.paste): only when the board has focus (focus is NOT inside a
  // text editor/input, which owns the event) and the clipboard has image
  // files. The handler is attached to `window` (paste does not bubble to the
  // board root) and also exposed for direct wiring.
  const onPaste = useCallback(
    (e: ClipboardEvent): void => {
      if (!canEditRef.current) return;
      const target = e.target as HTMLElement | null;
      // Let the editor handle paste of image data into a text field.
      if (target !== null && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        return;
      }
      const items = e.clipboardData?.items;
      if (items === undefined) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file !== null) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      void handleFiles(files, 'paste');
    },
    [handleFiles],
  );

  useEffect(() => {
    if (!canEdit) return;
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, onPaste]);

  // Drag-and-drop (window-level handlers on the board root).
  const hasFiles = (e: DragEvent): boolean =>
    e.dataTransfer !== null && Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = useCallback(
    (e: DragEvent): void => {
      if (!canEditRef.current || !hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDragActive(true);
    },
    [],
  );

  const onDragOver = useCallback((e: DragEvent): void => {
    if (!canEditRef.current || !hasFiles(e)) return;
    e.preventDefault(); // allow the drop
    // The pointer shows the copy indicator while files are dragged over.
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((e: DragEvent): void => {
    if (!hasFiles(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent): void => {
      if (!canEditRef.current || !hasFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragActive(false);
      const files = e.dataTransfer?.files;
      if (files === undefined || files.length === 0) return;
      void handleFiles([...files], 'drop', dropPoint(e.clientX, e.clientY));
    },
    [handleFiles, dropPoint],
  );

  const openPicker = useCallback((): void => {
    if (!canEditRef.current) return;
    // Adding images requires a connection (image.offline): no picker while
    // the board is not connected.
    if (!isConnected()) {
      push(REJECTION_MESSAGES.offline);
      return;
    }
    pickerRef.current?.click();
  }, [push]);

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      const files = e.target.files;
      if (files !== null && files.length > 0) {
        void handleFiles([...files], 'pick');
      }
      e.target.value = ''; // allow re-picking the same file
    },
    [handleFiles],
  );

  // The upload API provided to ImageObjects via ImageUploadContext.
  const uploadApi = useMemo<ImageUploadApi>(
    () => ({
      info(id: string) {
        const p = progress[id];
        return { progress: p, canRetry: filesRef.current.has(id) };
      },
      retry(id: string): void {
        const file = filesRef.current.get(id);
        if (file === undefined) return;
        beginUpload(id, file, true);
      },
      remove(id: string): void {
        undoRef.current?.boundary();
        deleteObjects(docRef.current, [id]);
        undoRef.current?.boundary();
        filesRef.current.delete(id);
        clearProgress(id);
      },
    }),
    [progress, beginUpload, clearProgress],
  );

  const accept = (IMAGE_ACCEPTED_TYPES as readonly string[]).join(',');

  // Design interface: progress / retry / canRetry (uploader-side only).
  const progressMap = useMemo(() => new Map(Object.entries(progress)), [progress]);
  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false; // lost to a reload
      beginUpload(id, file, true);
      return true;
    },
    [beginUpload],
  );
  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return {
    isDragActive,
    toasts,
    uploadApi,
    openPicker,
    onInputChange,
    onPaste,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
    progress: progressMap,
    retry,
    canRetry,
    accept,
    pickerRef,
  };
}
