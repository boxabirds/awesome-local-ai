// Adding images (story 12, image.insert): drop, paste and the Image tool's
// file picker share one flow — offline gate, validation, content check and
// natural size, one placeholder transaction (one undo step), then parallel
// uploads whose outcomes are written with UPLOAD_ORIGIN (no extra undo step).
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '../../shared/config';
import { sniffImageType } from '../../shared/image-format';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type PlaceholderItem,
} from '../../shared/objects/image';
import type { UndoController } from '../board/undo';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, REJECTION_ORDER, validateFiles, type FileRejection } from './validateFiles';

const HALF = 2;

/** The parts of a (React or DOM) drag event the flows read. */
export interface DragLike {
  dataTransfer: DataTransfer | null;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
  preventDefault(): void;
}

/** The parts of a paste event the flow reads. */
export interface PasteLike {
  clipboardData: DataTransfer | null;
  target: EventTarget | null;
  preventDefault(): void;
}

export interface ToastMessage {
  id: number;
  messages: string[];
}

export interface ImageInsert {
  onDragEnter(e: DragLike): void;
  onDragOver(e: DragLike): void;
  onDragLeave(e: DragLike): void;
  onDrop(e: DragLike): void;
  onPaste(e: PasteLike): void;
  openPicker(): void;
  /** Upload progress (0–1) of this tab's running uploads, by image id. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** Files are being dragged over the board (drop highlight). */
  dragActive: boolean;
  /** The current message toast, if any. */
  toast: ToastMessage | null;
  dismissToast(): void;
  /** Hidden `<input type=file>` the picker opens; render it once. */
  pickerInput: ReactElement;
}

/** Files are only uploaded while the board is connected (image.offline). */
export function canUpload(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

function isFileDrag(e: DragLike): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

/** Text is being edited (note, text, label or any field): paste belongs to the editor. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The file's type from its content (magic bytes), or null. */
async function sniffFile(file: File): Promise<string | null> {
  try {
    const head = new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer());
    return sniffImageType(head);
  } catch {
    return null;
  }
}

/** Natural pixel size by decoding the image, or null when it cannot be decoded. */
async function naturalSize(file: File): Promise<Size | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

type Placement = { anchor: 'top-left'; at: Point } | { anchor: 'centre' };

export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Visible board size in screen pixels (default: the window). */
  viewport?: Size;
  /** Adding is one undo step: boundaries go around the placeholder transaction. */
  undo?: UndoController;
}): ImageInsert {
  const latest = useRef(a);
  latest.current = a;
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const files = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, () => void>());
  const dragDepth = useRef(0);
  const toastId = useRef(0);
  const mounted = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    const running = uploads.current;
    return () => {
      mounted.current = false;
      for (const abort of running.values()) abort();
      running.clear();
    };
  }, []);

  const show = useCallback((messages: string[]) => {
    if (messages.length === 0 || !mounted.current) return;
    toastId.current += 1;
    setToast({ id: toastId.current, messages });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const setFraction = useCallback((id: string, fraction: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const { doc, boardId } = latest.current;
      setFraction(id, 0);
      const task = uploadImage(boardId, file, (f) => {
        if (mounted.current) setFraction(id, f);
      });
      uploads.current.set(id, task.abort);
      void task.promise.then((result) => {
        uploads.current.delete(id);
        if (!mounted.current) return;
        setFraction(id, null);
        if (result.kind === 'ok' && markImageReady(doc, id, result.assetKey)) {
          files.current.delete(id);
        } else if (!markImageFailed(doc, id)) {
          files.current.delete(id); // removed (or undone) meanwhile
        }
      });
    },
    [setFraction],
  );

  /** False (with the offline toast) when uploads cannot start; silent on a board that failed to load. */
  const gate = useCallback((): boolean => {
    const { connection } = latest.current;
    if (connection === 'load_failed') return false;
    if (!canUpload(connection)) {
      show([REJECTION_MESSAGES.offline]);
      return false;
    }
    return true;
  }, [show]);

  const addFiles = useCallback(
    async (list: readonly File[], placement: Placement) => {
      if (list.length === 0 || !gate()) return;
      const { accepted, rejections } = validateFiles(list);
      const measured = await Promise.all(
        accepted.map(async (file) => {
          const type = await sniffFile(file);
          const size = type ? await naturalSize(file) : null;
          return type && size ? { file, type, size } : null;
        }),
      );
      if (!mounted.current) return;
      const ok = measured.filter((m): m is NonNullable<typeof m> => m !== null);
      if (ok.length < accepted.length) rejections.add('type');
      const messages = REJECTION_ORDER.filter((r: FileRejection) => rejections.has(r)).map((r) => REJECTION_MESSAGES[r]);
      if (ok.length === 0) {
        show(messages);
        return;
      }
      const { doc, camera, identityId, undo } = latest.current;
      if (!canUpload(latest.current.connection)) {
        show([REJECTION_MESSAGES.offline]); // the connection dropped while files were read
        return;
      }
      const sizes = ok.map((m) => placementSize(m.size.width, m.size.height));
      const view = latest.current.viewport ?? { width: window.innerWidth, height: window.innerHeight };
      const rects =
        placement.anchor === 'top-left'
          ? layoutRow(sizes, placement.at, 'top-left')
          : layoutRow(sizes, screenToWorld(camera, { x: view.width / HALF, y: view.height / HALF }), 'centre');
      const items: PlaceholderItem[] = ok.map((m, i) => ({
        rect: rects[i],
        naturalWidth: m.size.width,
        naturalHeight: m.size.height,
        contentType: m.type,
      }));
      undo?.boundary();
      const ids = createImagePlaceholders(doc, items, identityId, Date.now());
      undo?.boundary();
      show(messages);
      ids.forEach((id, i) => {
        files.current.set(id, ok[i].file);
        startUpload(id, ok[i].file);
      });
    },
    [gate, show, startUpload],
  );

  const onDragEnter = useCallback((e: DragLike) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  }, []);

  const onDragOver = useCallback((e: DragLike) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); // allows the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: DragLike) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragLike) => {
      if (!isFileDrag(e)) return;
      e.preventDefault(); // never navigate to the file
      dragDepth.current = 0;
      setDragActive(false);
      const list = Array.from(e.dataTransfer?.files ?? []);
      const el = e.currentTarget instanceof Element ? e.currentTarget : null;
      const rect = el?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const at = screenToWorld(latest.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      const known = Number.isFinite(at.x) && Number.isFinite(at.y);
      void addFiles(list, known ? { anchor: 'top-left', at } : { anchor: 'centre' });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: PasteLike) => {
      if (isEditable(e.target) || isEditable(document.activeElement)) return; // the editor pastes text
      const list = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) return;
      e.preventDefault();
      void addFiles(list, { anchor: 'centre' });
    },
    [addFiles],
  );

  // Paste reaches the board from anywhere on the page that is not a text field.
  useEffect(() => {
    const handler = (e: Event) => onPaste(e as ClipboardEvent);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [onPaste]);

  // Files dropped outside the board (toolbars, panels) must not open in the tab.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    };
    const reset = () => {
      dragDepth.current = 0;
      setDragActive(false);
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  const openPicker = useCallback(() => {
    if (!gate()) return;
    const input = inputRef.current;
    if (!input) return;
    input.value = ''; // choosing the same file again still fires change
    input.click();
  }, [gate]);

  const pickerInput = useMemo(
    () =>
      createElement('input', {
        ref: inputRef,
        type: 'file',
        multiple: true,
        accept: IMAGE_ACCEPTED_TYPES.join(','),
        hidden: true,
        tabIndex: -1,
        'aria-hidden': true,
        'data-testid': 'image-picker',
        onChange: (e: ChangeEvent<HTMLInputElement>) => {
          const chosen = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          void addFiles(chosen, { anchor: 'centre' });
        },
      }),
    [addFiles],
  );

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (!file || !gate()) return false;
      if (!markImageRetrying(latest.current.doc, id, Date.now())) {
        files.current.delete(id);
        return false;
      }
      startUpload(id, file);
      return true;
    },
    [gate, startUpload],
  );

  const canRetry = useCallback((id: string) => files.current.has(id), []);

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
    dragActive,
    toast,
    dismissToast,
    pickerInput,
  };
}
