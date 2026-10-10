import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ConnectionState } from '../sync/connectBoard';
import type { UndoController } from '../board/undo';
import { screenToWorld, type Camera } from '../canvas/camera';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  layoutRow,
  placementSize
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { validateFiles, REJECTION_MESSAGES } from './validateFiles';
import { uploadImage } from './uploadImage';
import { showToast } from '../ui/Toast';

// Structurally compatible with React's synthetic DragEvent/ClipboardEvent so
// the same handlers wire into JSX props and can be driven directly in tests.
export interface DragLike {
  preventDefault(): void;
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer | null;
}

export interface ClipboardLike {
  preventDefault(): void;
  target: EventTarget | null;
  clipboardData: DataTransfer | null;
}

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  // Optional: bounds the placeholder transaction into its own undo step.
  undo?: UndoController;
}

export interface ImageInsertController {
  onDragEnter(e: DragLike): void;
  onDragOver(e: DragLike): void;
  onDragLeave(e: DragLike): void;
  onDrop(e: DragLike): void;
  onPaste(e: ClipboardLike): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  // True between dragenter and dragleave/drop for drags carrying files.
  draggingFiles: boolean;
}

const EMPTY_PROGRESS: ReadonlyMap<string, number> = new Map();

function isConnected(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

function hasFiles(e: DragLike): boolean {
  const types = e.dataTransfer?.types;
  if (types === undefined || types === null) return false;
  return Array.from(types).includes('Files');
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

// Drop, paste and picker flows: validate, measure, place one row of
// placeholders (one undo step), then XHR-upload each file and mark the
// object ready or failed. Failures are surfaced as toasts or failed
// states, never thrown. The id → File map powers Retry until reload.
export function useImageInsert(a: UseImageInsertArgs): ImageInsertController {
  const argsRef = useRef(a);
  argsRef.current = a;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(EMPTY_PROGRESS);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const filesRef = useRef(new Map<string, File>());
  const activeAborts = useRef(new Set<() => void>());
  useEffect(() => {
    const aborts = activeAborts.current;
    return () => {
      for (const abort of aborts) abort();
      aborts.clear();
    };
  }, []);

  const setProgressEntry = useCallback((id: string, fraction: number | undefined) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === undefined) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const { boardId } = argsRef.current;
      const { promise, abort } = uploadImage(boardId, file, (fraction) =>
        setProgressEntry(id, fraction)
      );
      const aborts = activeAborts.current;
      aborts.add(abort);
      void promise.then((result) => {
        aborts.delete(abort);
        setProgressEntry(id, undefined);
        if (result.kind === 'ok') markImageReady(argsRef.current.doc, id, result.assetKey);
        else markImageFailed(argsRef.current.doc, id);
      });
    },
    [setProgressEntry]
  );

  // mode 'top-left': first image's corner at the anchor (drop point);
  // 'centre': the whole row centred on the anchor (paste, picker).
  const addFiles = useCallback(
    async (files: readonly File[], anchor: { x: number; y: number }, mode: 'top-left' | 'centre') => {
      const { doc, identityId, connection, undo } = argsRef.current;
      if (!isConnected(connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const kind of ['type', 'size', 'count'] as const) {
        if (rejections.has(kind)) showToast(REJECTION_MESSAGES[kind]);
      }
      if (accepted.length === 0) return;

      // Measure natural dimensions; undecodable files are refused with the
      // type message (content, not name, decides), like the server's sniff.
      const decoded: { file: File; width: number; height: number }[] = [];
      let decodeFailed = false;
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          decoded.push({ file, width: bitmap.width, height: bitmap.height });
          bitmap.close?.();
        } catch {
          decodeFailed = true;
        }
      }
      if (decodeFailed) showToast(REJECTION_MESSAGES.type);
      if (decoded.length === 0) return;

      const sizes = decoded.map((d) => placementSize(d.width, d.height));
      const rects = layoutRow(sizes, anchor, mode);
      const items = decoded.map((d, i) => ({
        rect: rects[i],
        naturalWidth: d.width,
        naturalHeight: d.height,
        contentType: d.file.type
      }));
      const ids = (() => {
        undo?.boundary();
        try {
          return createImagePlaceholders(doc, items, identityId, Date.now());
        } finally {
          undo?.boundary();
        }
      })();
      ids.forEach((id, i) => {
        filesRef.current.set(id, decoded[i].file);
        startUpload(id, decoded[i].file);
      });
    },
    [startUpload]
  );

  const viewCentre = useCallback(() => {
    const { camera } = argsRef.current;
    return screenToWorld(camera, {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    });
  }, []);

  const onDragEnter = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDraggingFiles(true);
  }, []);

  const onDragOver = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // required for the drop event to fire
  }, []);

  const onDragLeave = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingFiles(false);
  }, []);

  const onDrop = useCallback(
    (e: DragLike) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDraggingFiles(false);
      const files = e.dataTransfer?.files;
      if (files === undefined || files.length === 0) return;
      const world = screenToWorld(argsRef.current.camera, { x: e.clientX, y: e.clientY });
      void addFiles(Array.from(files), world, 'top-left');
    },
    [addFiles]
  );

  // Paste with image files adds them centred; while any text entry has
  // focus the paste is left to the editor untouched.
  const onPaste = useCallback(
    (e: ClipboardLike) => {
      if (isTextEntry(e.target)) return;
      const files = e.clipboardData?.files;
      if (files === undefined || files.length === 0) return;
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      void addFiles(images, viewCentre(), 'centre');
    },
    [addFiles, viewCentre]
  );

  // System picker filtered to the accepted types; cancelled picker adds
  // nothing. The board never leaves the Select tool.
  const openPicker = useCallback(() => {
    if (!isConnected(argsRef.current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      if (files.length > 0) void addFiles(files, viewCentre(), 'centre');
    });
    input.addEventListener('cancel', cleanup);
    document.body.appendChild(input);
    input.click();
  }, [addFiles, viewCentre]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false;
      if (!markImageRetrying(argsRef.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload]
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
    draggingFiles
  };
}
