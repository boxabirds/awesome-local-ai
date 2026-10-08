// useImageInsert (story 12, image.insert): the client half of image
// insertion. Drop, paste and the file picker all funnel into one path:
// validate → decode → createImagePlaceholders (one undo step) → upload each
// file (progress → markImageReady / markImageFailed).
//
//  - Rejections and decode failures produce toasts with the exact PRD
//    wording; supported files from the same action are still added.
//  - The hook keeps the accepted File per object id in memory so Retry
//    re-sends the same bytes; when it is gone (page closed) others see the
//    "unfinished" state instead.
//  - Adding is disabled while the connection is not live (image.offline):
//    one toast, nothing inserted.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { screenToWorld, type Camera } from '../canvas/camera';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import { uploadImage } from './uploadImage';
import type { ConnectionState } from '../sync/connectBoard';

/** How long a toast stays visible before dismissing itself (ms). */
export const TOAST_VISIBLE_MS = 4000;

export interface UseImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
}

export interface UseImageInsert {
  /** Wire to the board root: allows the drop (and the highlight). */
  onDragOver(e: DragEvent): void;
  /** Wire to the board root: inserts the dropped files at the drop point. */
  onDrop(e: DragEvent): void;
  /** Paste an image from the clipboard, centred (no-op without files). */
  onPaste(e: ClipboardEvent): void;
  /** Open the file picker (the hidden input the caller renders). */
  openPicker(): void;
  /** The hidden file input the caller renders with this ref. */
  pickerInputRef: { readonly current: HTMLInputElement | null };
  onPickerChange(e: { target: HTMLInputElement }): void;
  /** Upload progress per object id (0..1), while uploads are in flight. */
  readonly progress: ReadonlyMap<string, number>;
  /** Restart the upload for `id` with the same in-memory file. */
  retry(id: string): boolean;
  /** True when `id`'s file is still in memory and Retry can re-send it. */
  canRetry(id: string): boolean;
  /** Drop this object's in-memory file (after it is removed from the doc). */
  forget(id: string): void;
  /** Toast messages currently visible (for rendering). */
  readonly toasts: readonly string[];
}

/** The live connection states in which adding images is allowed. */
const LIVE: ReadonlySet<ConnectionState> = new Set<ConnectionState>([
  'connected',
  'confirmed',
]);

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes('Files');
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

export function useImageInsert(args: UseImageInsertArgs): UseImageInsert {
  const { doc, identityId } = args;
  const argsRef = useRef(args);
  argsRef.current = args;

  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [toasts, setToasts] = useState<readonly string[]>([]);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /** Object id → the accepted File still in memory (Retry source). */
  const filesRef = useRef(new Map<string, File>());
  const abortsRef = useRef(new Map<string, () => void>());
  const inputRef = useRef<HTMLInputElement | null>(null);

  const toast = useCallback((message: string) => {
    setToasts((prev) => (prev.includes(message) ? prev : [...prev, message]));
    const existing = toastTimers.current.get(message);
    if (existing !== undefined) {
      clearTimeout(existing);
      toastTimers.current.delete(message);
    }
    toastTimers.current.set(
      message,
      setTimeout(() => {
        toastTimers.current.delete(message);
        setToasts((cur) => cur.filter((m) => m !== message));
      }, TOAST_VISIBLE_MS),
    );
  }, []);

  const setProgressFor = useCallback((id: string, fraction: number) => {
    setProgress((prev) => {
      const next = new Map(prev);
      next.set(id, fraction);
      return next;
    });
  }, []);

  const clearProgressFor = useCallback((id: string) => {
    setProgress((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /** Insert placeholders for `items` and upload `files[i]` for the id[i]. */
  const startUpload = useCallback(
    (id: string, file: File): void => {
      filesRef.current.set(id, file);
      const { boardId } = argsRef.current;
      const prevAbort = abortsRef.current.get(id);
      if (prevAbort !== undefined) prevAbort();
      const { promise, abort } = uploadImage(
        boardId,
        file,
        (fraction) => setProgressFor(id, fraction),
      );
      abortsRef.current.set(id, abort);
      void promise.then((res) => {
        if (abortsRef.current.get(id) !== abort) return; // replaced (retry)
        abortsRef.current.delete(id);
        if (res.kind === 'ok') {
          markImageReady(doc, id, res.assetKey);
        } else {
          markImageFailed(doc, id);
        }
        clearProgressFor(id);
      });
    },
    [doc, setProgressFor, clearProgressFor],
  );

  const addFiles = useCallback(
    async (
      files: File[],
      anchor: 'top-left' | 'centre',
      at?: { x: number; y: number },
    ): Promise<void> => {
      const { connection } = argsRef.current;
      if (!LIVE.has(connection)) {
        toast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      for (const reason of rejections) toast(REJECTION_MESSAGES[reason]);
      if (accepted.length === 0) return;

      // Decode each accepted file to learn its natural size. A file whose
      // bytes do not decode is reported with the type message (it is not a
      // usable image), and the rest of the batch is still added.
      const decoded: { file: File; naturalWidth: number; naturalHeight: number }[] = [];
      let anyDecodeFailed = false;
      for (const file of accepted) {
        try {
          const bmp = await createImageBitmap(file);
          decoded.push({
            file,
            naturalWidth: bmp.width,
            naturalHeight: bmp.height,
          });
          bmp.close();
        } catch {
          anyDecodeFailed = true;
        }
      }
      if (anyDecodeFailed) toast(REJECTION_MESSAGES.type);
      if (decoded.length === 0) return;

      const sizes = decoded.map((d) => placementSize(d.naturalWidth, d.naturalHeight));
      const cam = argsRef.current.camera;
      const point =
        at ??
        screenToWorld(cam, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const rects = layoutRow(sizes, point, anchor);
      const items = decoded.map((d, i) => {
        const rect = rects[i]!;
        return {
          rect,
          naturalWidth: d.naturalWidth,
          naturalHeight: d.naturalHeight,
          contentType: d.file.type,
        };
      });
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      ids.forEach((id, i) => {
        startUpload(id, decoded[i]!.file);
      });
    },
    [doc, identityId, toast, startUpload],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const cam = argsRef.current.camera;
      const world = screenToWorld(cam, { x: e.clientX, y: e.clientY });
      void addFiles(files, 'top-left', world);
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      void addFiles(files, 'centre');
    },
    [addFiles],
  );

  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;

  // The window paste listener: an image pastes only when the board (not a
  // text editor) has focus — an editable target owns its own paste
  // (image.paste).
  useEffect(() => {
    const onWindowPaste = (e: Event): void => {
      const ce = e as ClipboardEvent;
      if (typeof ce.clipboardData?.files === 'undefined') return;
      if (isEditableTarget(document.activeElement)) return;
      onPasteRef.current(ce);
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, []);

  const openPicker = useCallback(() => {
    const { connection } = argsRef.current;
    if (!LIVE.has(connection)) {
      toast(REJECTION_MESSAGES.offline);
      return;
    }
    inputRef.current?.click();
  }, [toast]);

  const onPickerChange = useCallback(
    (e: { target: HTMLInputElement }) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      if (files.length > 0) void addFiles(files, 'centre');
    },
    [addFiles],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false;
      markImageRetrying(doc, id, Date.now());
      startUpload(id, file);
      return true;
    },
    [doc, startUpload],
  );

  const canRetry = useCallback((id: string): boolean => filesRef.current.has(id), []);

  const forget = useCallback(
    (id: string): void => {
      filesRef.current.delete(id);
      const abort = abortsRef.current.get(id);
      if (abort !== undefined) {
        abort();
        abortsRef.current.delete(id);
      }
      clearProgressFor(id);
    },
    [clearProgressFor],
  );

  // Abort in-flight uploads and toast timers on unmount.
  useEffect(() => {
    const aborts = abortsRef.current;
    const timers = toastTimers.current;
    const files = filesRef.current;
    return () => {
      for (const abort of aborts.values()) abort();
      aborts.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      files.clear();
    };
  }, []);

  return {
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    pickerInputRef: inputRef,
    onPickerChange,
    progress,
    retry,
    canRetry,
    forget,
    toasts,
  };
}
