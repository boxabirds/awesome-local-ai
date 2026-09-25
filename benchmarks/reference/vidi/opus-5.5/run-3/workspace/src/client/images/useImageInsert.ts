// Adding images (story 12): drop, paste and the Image tool's file picker share one flow — offline gate, validation,
// natural size from decoding, one placeholder transaction (one undo step), then parallel uploads that mark each
// placeholder ready or failed. Files are kept in memory for Retry until the page is left.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { NO_UNDO, type UndoController } from '../board/undo';
import { asStep } from '../board/useUndo';
import type { ConnectionState } from '../sync/connectBoard';
import type { ToastMessage } from '../ui/Toast';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';

/** The parts of a drag event the drop flow reads (React and native drag events both fit). */
export interface DragLike {
  dataTransfer: DataTransfer | null;
  clientX: number;
  clientY: number;
  relatedTarget?: EventTarget | null;
  currentTarget: EventTarget | null;
  preventDefault(): void;
}

export interface ImageInsertOptions {
  doc: Y.Doc;
  boardId: string | undefined;
  connection: ConnectionState;
  identityId: string;
  /** World point under client coordinates (drop point). */
  toWorld(clientX: number, clientY: number): Point;
  /** World point at the centre of the visible board (paste and picker). */
  viewCentre(): Point;
  undo?: UndoController;
  /** True while an object's text is being edited: pasting pastes text, never an image. */
  isEditing?: boolean;
}

export interface ImageInsert {
  onDragEnter(e: DragLike): void;
  onDragOver(e: DragLike): void;
  onDragLeave(e: DragLike): void;
  onDrop(e: DragLike): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** Spread onto the hidden `<input type=file>` rendered once on the board. */
  pickerInput: {
    ref: RefObject<HTMLInputElement | null>;
    type: 'file';
    accept: string;
    multiple: true;
    hidden: true;
    tabIndex: -1;
    'aria-hidden': true;
    'data-testid': string;
    onChange(e: ChangeEvent<HTMLInputElement>): void;
  };
  /** Files are being dragged over the board. */
  dragging: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** Drops the kept file for an image that is being removed. */
  forget(id: string): void;
  message: ToastMessage | null;
  dismissMessage(): void;
}

/** Whether uploads may start: only while connected (not connecting, reconnecting or load-failed). */
export function isOnline(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files');
}

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Natural pixel size of an image file; rejects when it cannot be decoded. */
async function measure(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  if (!(size.width > 0 && size.height > 0)) throw new Error('empty image');
  return size;
}

export function useImageInsert(a: ImageInsertOptions): ImageInsert {
  const latest = useRef(a);
  latest.current = a;
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const messageId = useRef(0);
  // id → the file being (or last) uploaded for it, for Retry. Memory only: lost on reload by design.
  const files = useRef(new Map<string, File>());
  const [filesVersion, setFilesVersion] = useState(0);
  const aborts = useRef(new Set<() => void>());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      aborts.current.forEach((abort) => abort());
      aborts.current.clear();
    },
    [],
  );

  const toast = useCallback((lines: string[]) => {
    if (lines.length === 0) return;
    setMessage({ id: ++messageId.current, lines: [...new Set(lines)] });
  }, []);
  const dismissMessage = useCallback(() => setMessage(null), []);

  const setFraction = useCallback((id: string, f: number | null) => {
    setProgress((prev) => {
      if (f === null ? !prev.has(id) : prev.get(id) === f) return prev;
      const next = new Map(prev);
      if (f === null) next.delete(id);
      else next.set(id, f);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const { doc, boardId } = latest.current;
      files.current.set(id, file);
      setFilesVersion((v) => v + 1);
      setFraction(id, 0);
      const job = uploadImage(boardId ?? '', file, (f) => setFraction(id, f));
      aborts.current.add(job.abort);
      void job.promise.then((result) => {
        aborts.current.delete(job.abort);
        setFraction(id, null);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
          files.current.delete(id);
          setFilesVersion((v) => v + 1);
          return;
        }
        markImageFailed(doc, id);
        if (result.kind === 'rate_limited') toast([REJECTION_MESSAGES.rate]);
      });
    },
    [setFraction, toast],
  );

  const add = useCallback(
    async (list: readonly File[], at: Point, anchor: 'top-left' | 'centre') => {
      if (list.length === 0) return;
      if (!isOnline(latest.current.connection)) {
        toast([REJECTION_MESSAGES.offline]);
        return;
      }
      const { accepted, rejections } = validateFiles(list);
      const measured = await Promise.all(accepted.map((f) => measure(f).catch(() => null)));
      const good: Array<{ file: File; width: number; height: number }> = [];
      measured.forEach((size, i) => {
        if (size) good.push({ file: accepted[i], ...size });
        else rejections.add('type');
      });
      const lines = (['type', 'size', 'count'] as FileRejection[]).filter((r) => rejections.has(r)).map((r) => REJECTION_MESSAGES[r]);
      if (good.length === 0) {
        toast(lines);
        return;
      }
      const { doc, identityId, undo } = latest.current;
      const rects = layoutRow(
        good.map((g) => placementSize(g.width, g.height)),
        at,
        anchor,
      );
      const ids = asStep(undo ?? NO_UNDO, () =>
        createImagePlaceholders(
          doc,
          good.map((g, i) => ({ rect: rects[i], naturalWidth: g.width, naturalHeight: g.height, contentType: g.file.type })),
          identityId,
          Date.now(),
        ),
      );
      toast(lines);
      ids.forEach((id, i) => startUpload(id, good[i].file));
    },
    [startUpload, toast],
  );

  const onDragEnter = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragOver = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragLike) => {
    const to = e.relatedTarget;
    const from = e.currentTarget;
    // Still over the board (moving between its children): keep the highlight.
    if (to instanceof Node && from instanceof Node && from.contains(to)) return;
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragLike) => {
      setDragging(false);
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const list = Array.from(e.dataTransfer?.files ?? []);
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) {
        // No usable drop point (synthetic events): place like a paste.
        void add(list, latest.current.viewCentre(), 'centre');
        return;
      }
      void add(list, latest.current.toWorld(e.clientX, e.clientY), 'top-left');
    },
    [add],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (latest.current.isEditing || isTextField(document.activeElement)) return;
      if (e.target instanceof Element && isTextField(e.target)) return;
      const list = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) return;
      e.preventDefault();
      void add(list, latest.current.viewCentre(), 'centre');
    },
    [add],
  );

  useEffect(() => {
    const onWindowPaste = (e: ClipboardEvent) => onPaste(e);
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [onPaste]);

  const openPicker = useCallback(() => {
    if (!isOnline(latest.current.connection)) {
      toast([REJECTION_MESSAGES.offline]);
      return;
    }
    inputRef.current?.click();
  }, [toast]);

  const onPickerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = Array.from(e.currentTarget.files ?? []);
      // Clear it so choosing the same file again fires another change.
      e.currentTarget.value = '';
      void add(list, latest.current.viewCentre(), 'centre');
    },
    [add],
  );

  // A new function whenever the kept files change, so memoised image objects re-render.
  const canRetry = useCallback((id: string) => files.current.has(id), [filesVersion]);

  const forget = useCallback((id: string) => {
    if (files.current.delete(id)) setFilesVersion((v) => v + 1);
  }, []);

  const retry = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (!file) return false;
      if (!isOnline(latest.current.connection)) {
        toast([REJECTION_MESSAGES.offline]);
        return false;
      }
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload, toast],
  );

  return {
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
    openPicker,
    pickerInput: {
      ref: inputRef,
      type: 'file',
      accept: IMAGE_ACCEPTED_TYPES.join(','),
      multiple: true,
      hidden: true,
      tabIndex: -1,
      'aria-hidden': true,
      'data-testid': 'image-picker',
      onChange: onPickerChange,
    },
    dragging,
    progress,
    retry,
    canRetry,
    forget,
    message,
    dismissMessage,
  };
}
