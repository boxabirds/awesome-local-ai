/**
 * Adding images (story 12): drop, paste and the Image tool's file picker share one flow.
 *
 *   offline gate → validateFiles (type, size, count) → decode for the pixel size (failure = type
 *   message) → placementSize + layoutRow → ONE createImagePlaceholders call (one undo step) →
 *   parallel XHR uploads with progress → markImageReady / markImageFailed (UPLOAD_ORIGIN).
 *
 * Refusals are shown as a toast with the PRD's wording; nothing here throws. The files are
 * kept in memory by object id so the uploader can Retry a failed upload; a reload loses them
 * (then only Remove is offered).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type PlaceholderItem,
} from '../../shared/objects/image';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage, type UploadResult } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';

const HALF = 2;
/** DataTransfer type present while files (not text or links) are dragged. */
const FILES_DRAG_TYPE = 'Files';
/** The picker's `accept` attribute: the supported types only. */
export const IMAGE_PICKER_ACCEPT = IMAGE_ACCEPTED_TYPES.join(',');
const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

export interface ImageInsertArgs {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Board area size, for "centred in the visible area" (picker and paste). */
  viewport?: Size;
  /** False while the board cannot be edited (story 4 load failure): nothing is added. */
  canEdit?: boolean;
  /** True while text is being edited on the board: pasting then pastes text, never an image. */
  isEditingText?(): boolean;
  /** Runs one user action as one undo step (story 8); default runs it as is. */
  step?<T>(action: () => T): T;
}

export interface ImageInsert {
  onDragOver(e: DragEvent | React.DragEvent): void;
  onDrop(e: DragEvent | React.DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** Upload progress (0..1) of this person's running uploads, by object id. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** Drop highlight: files are being dragged over the board. */
  dragActive: boolean;
  onDragLeave(e: DragEvent | React.DragEvent): void;
  /** The hidden file input the picker opens (rendered by the board). */
  pickerRef: React.RefObject<HTMLInputElement | null>;
  onPickerChange(e: React.ChangeEvent<HTMLInputElement>): void;
  /** Messages of the current toast ([] when none) and a key that changes with each new toast. */
  toast: { messages: readonly string[]; key: number };
  dismissToast(): void;
}

type Placement = { at: Point; anchor: 'top-left' | 'centre' };

/** Pixel size of an image file; rejects when the browser cannot decode it. */
export async function measureImage(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isFileDrag(e: DragEvent | React.DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes(FILES_DRAG_TYPE);
}

function isEditableElement(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Only a synced board takes new images: uploads need the room to share the result. */
export function isOnline(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

function clipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length > 0) return files;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

export function useImageInsert(args: ImageInsertArgs): ImageInsert {
  const argsRef = useRef(args);
  argsRef.current = args;
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState<{ messages: readonly string[]; key: number }>({ messages: [], key: 0 });
  const pickerRef = useRef<HTMLInputElement | null>(null);
  /** Files by object id, for Retry (in memory only). */
  const filesRef = useRef(new Map<string, File>());
  /** Uploads in flight, aborted when the board goes away. */
  const abortsRef = useRef(new Map<string, () => void>());
  const mountedRef = useRef(true);
  /**
   * Outcomes that arrived while their placeholder was not on the board (undone mid-upload). A
   * redo brings the placeholder back, and the outcome is applied then.
   */
  const unappliedRef = useRef(new Map<string, UploadResult>());

  const applyResult = useCallback((id: string, result: UploadResult): boolean => {
    const { doc } = argsRef.current;
    return result.kind === 'ok' ? markImageReady(doc, id, result.assetKey) : markImageFailed(doc, id);
  }, []);

  useEffect(() => {
    const objects = args.doc.getMap('objects');
    const pending = unappliedRef.current;
    const onChange = () => {
      if (pending.size === 0) return;
      // After the change's transaction, so the outcome is a transaction of its own.
      queueMicrotask(() => {
        for (const [id, result] of [...pending]) {
          if (!objects.has(id)) continue;
          pending.delete(id);
          applyResult(id, result);
        }
      });
    };
    objects.observe(onChange);
    return () => objects.unobserve(onChange);
  }, [args.doc, applyResult]);

  useEffect(() => {
    mountedRef.current = true;
    const aborts = abortsRef.current;
    return () => {
      mountedRef.current = false;
      for (const abort of aborts.values()) abort();
      aborts.clear();
    };
  }, []);

  const showMessages = useCallback((messages: readonly string[]) => {
    if (messages.length === 0 || !mountedRef.current) return;
    setToast((t) => ({ messages, key: t.key + 1 }));
  }, []);

  const setFraction = useCallback((id: string, fraction: number | undefined) => {
    if (!mountedRef.current) return;
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
      setFraction(id, 0);
      const { promise, abort } = uploadImage(boardId, file, (f) => setFraction(id, f));
      abortsRef.current.set(id, abort);
      void promise.then((result: UploadResult) => {
        abortsRef.current.delete(id);
        setFraction(id, undefined);
        if (!mountedRef.current) return;
        if (!argsRef.current.doc.getMap('objects').has(id)) unappliedRef.current.set(id, result);
        else applyResult(id, result);
        if (result.kind === 'rate_limited') showMessages([REJECTION_MESSAGES.rate]);
      });
    },
    [setFraction, showMessages, applyResult],
  );

  const addFiles = useCallback(
    async (files: readonly File[], placement: () => Placement) => {
      const { connection, canEdit = true } = argsRef.current;
      if (files.length === 0 || !canEdit) return;
      if (!isOnline(connection)) {
        showMessages([REJECTION_MESSAGES.offline]);
        return;
      }
      const { accepted, rejections } = validateFiles(files);
      const measured = await Promise.all(
        accepted.map((file) =>
          measureImage(file).then(
            (size) => ({ file, size }),
            () => null,
          ),
        ),
      );
      const ready: { file: File; size: { width: number; height: number } }[] = [];
      for (const m of measured) {
        if (m && m.size.width > 0 && m.size.height > 0) ready.push(m);
        else rejections.add('type');
      }
      showMessages(REJECTION_ORDER.filter((r) => rejections.has(r)).map((r) => REJECTION_MESSAGES[r]));
      if (ready.length === 0 || !mountedRef.current) return;
      const { doc, identityId, step = (a) => a() } = argsRef.current;
      const { at, anchor } = placement();
      const rects = layoutRow(
        ready.map((r) => placementSize(r.size.width, r.size.height)),
        at,
        anchor,
      );
      const items: PlaceholderItem[] = ready.map((r, i) => ({
        rect: rects[i]!,
        naturalWidth: r.size.width,
        naturalHeight: r.size.height,
        contentType: r.file.type,
      }));
      const ids = step(() => createImagePlaceholders(doc, items, identityId, Date.now()));
      ids.forEach((id, i) => {
        const file = ready[i]!.file;
        filesRef.current.set(id, file);
        startUpload(id, file);
      });
    },
    [showMessages, startUpload],
  );

  /** The world point at the centre of the visible board area. */
  const viewCentre = useCallback((): Placement => {
    const { camera, viewport = { width: 0, height: 0 } } = argsRef.current;
    return { at: screenToWorld(camera, { x: viewport.width / HALF, y: viewport.height / HALF }), anchor: 'centre' };
  }, []);

  const onDragOver = useCallback((e: DragEvent | React.DragEvent) => {
    if (!isFileDrag(e)) return;
    // Without this the browser would open the dropped file instead of handing it to the board.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent | React.DragEvent) => {
    const current = e.currentTarget instanceof Node ? e.currentTarget : null;
    const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
    // Moving between elements inside the board is not leaving it.
    if (current && next && current.contains(next)) return;
    setDragActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent | React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const target = e.currentTarget instanceof Element ? e.currentTarget : null;
      const rect = target?.getBoundingClientRect();
      const screen = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
      void addFiles(files, () => ({ at: screenToWorld(argsRef.current.camera, screen), anchor: 'top-left' }));
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (argsRef.current.isEditingText?.()) return;
      const target = e.target instanceof Element ? e.target : null;
      if (isEditableElement(target) || isEditableElement(document.activeElement)) return;
      const files = clipboardFiles(e.clipboardData);
      if (!files.some((f) => f.type.startsWith('image/'))) return;
      e.preventDefault();
      void addFiles(files, viewCentre);
    },
    [addFiles, viewCentre],
  );

  const openPicker = useCallback(() => {
    const { connection, canEdit = true } = argsRef.current;
    if (!canEdit) return;
    if (!isOnline(connection)) {
      showMessages([REJECTION_MESSAGES.offline]);
      return;
    }
    pickerRef.current?.click();
  }, [showMessages]);

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const files = Array.from(input.files ?? []);
      // Cleared so choosing the same file again fires another change.
      input.value = '';
      void addFiles(files, viewCentre);
    },
    [addFiles, viewCentre],
  );

  const canRetry = useCallback((id: string) => filesRef.current.has(id), []);

  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.get(id);
      if (!file) return false;
      const { connection, doc } = argsRef.current;
      if (!isOnline(connection)) {
        showMessages([REJECTION_MESSAGES.offline]);
        return false;
      }
      if (!markImageRetrying(doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [showMessages, startUpload],
  );

  const dismissToast = useCallback(() => setToast((t) => ({ messages: [], key: t.key })), []);

  return useMemo(
    () => ({
      onDragOver,
      onDrop,
      onPaste,
      openPicker,
      progress,
      retry,
      canRetry,
      dragActive,
      onDragLeave,
      pickerRef,
      onPickerChange,
      toast,
      dismissToast,
    }),
    [onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry, dragActive, onDragLeave, onPickerChange, toast, dismissToast],
  );
}
