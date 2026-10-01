import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import {
  createImagePlaceholders, layoutRow, markImageFailed, markImageReady, markImageRetrying, placementSize,
} from '../../shared/objects/image';
import { screenToWorld, type Camera, type Size } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import type { ConnectionState } from '../sync/connectBoard';
import { showToast } from '../ui/Toast';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';

const HALF = 2;

/** The parts of a drag or paste event this hook reads (React and native events both fit). */
interface DragLike {
  dataTransfer: DataTransfer | null; clientX: number; clientY: number; preventDefault(): void;
  currentTarget?: EventTarget | null;
}
interface PasteLike { clipboardData: DataTransfer | null; target: EventTarget | null; preventDefault(): void }

type Anchor = { kind: 'point'; world: { x: number; y: number } } | { kind: 'centre' };

const isOnline = (c: ConnectionState) => c === 'connected' || c === 'confirmed';
const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes('Files');
const isEditable = (t: EventTarget | null) => t instanceof HTMLElement
  && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export interface ImageInsert {
  onDragEnter(e: DragLike): void; onDragLeave(e: DragLike): void;
  onDragOver(e: DragLike): void; onDrop(e: DragLike): void; onPaste(e: PasteLike): void; openPicker(): void;
  progress: ReadonlyMap<string, number>; retry(id: string): boolean; canRetry(id: string): boolean;
  /** A file drag is over the board (drives the drop highlight). */
  dragActive: boolean;
  /** Hidden `<input type=file>` for the picker; render it once in the board. */
  inputRef: RefObject<HTMLInputElement | null>;
  onPickerChange(files: readonly File[]): void;
}

export function useImageInsert(a: {
  doc: Y.Doc; boardId: string; camera: Camera; connection: ConnectionState; identityId: string;
  /** Visible board size, for centring; defaults to the window. */
  viewSize?: () => Size;
  undo?: UndoController;
  /** Called when the picker finishes or is cancelled (the tool returns to Select). */
  onPickerDone?: () => void;
}): ImageInsert {
  const ref = useRef(a);
  ref.current = a;
  const files = useRef(new Map<string, File>());
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const setProgressFor = useCallback((id: string, value: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(id); else next.set(id, value);
      return next;
    });
  }, []);

  const startUpload = useCallback((id: string, file: File) => {
    const { boardId, doc } = ref.current;
    setProgressFor(id, 0);
    void uploadImage(boardId, file, (f) => setProgressFor(id, f)).promise.then((result) => {
      setProgressFor(id, null);
      if (result.kind === 'ok') {
        files.current.delete(id);
        markImageReady(doc, id, result.assetKey);
      } else {
        markImageFailed(doc, id);
      }
    });
  }, [setProgressFor]);

  const addFiles = useCallback(async (list: readonly File[], anchor: Anchor) => {
    const { doc, connection, identityId, camera, undo } = ref.current;
    if (list.length === 0) return;
    if (!isOnline(connection)) { showToast(REJECTION_MESSAGES.offline); return; }
    const { accepted, rejections } = validateFiles(list);
    const rejected = new Set<FileRejection>(rejections);
    const decoded: Array<{ file: File; width: number; height: number }> = [];
    for (const file of accepted) {
      try {
        const bitmap = await createImageBitmap(file);
        decoded.push({ file, width: bitmap.width, height: bitmap.height });
        bitmap.close?.();
      } catch {
        rejected.add('type');
      }
    }
    rejected.forEach((r) => showToast(REJECTION_MESSAGES[r]));
    if (decoded.length === 0) return;
    if (!isOnline(ref.current.connection)) { showToast(REJECTION_MESSAGES.offline); return; }
    const sizes = decoded.map((d) => placementSize(d.width, d.height));
    const view = ref.current.viewSize?.() ?? { width: window.innerWidth, height: window.innerHeight };
    const where = anchor.kind === 'point'
      ? anchor.world : screenToWorld(camera, { x: view.width / HALF, y: view.height / HALF });
    const rects = layoutRow(sizes, where, anchor.kind === 'point' ? 'top-left' : 'centre');
    undo?.boundary();
    const ids = createImagePlaceholders(doc, decoded.map((d, i) => ({
      rect: rects[i], naturalWidth: d.width, naturalHeight: d.height, contentType: d.file.type,
    })), identityId, Date.now());
    undo?.boundary();
    ids.forEach((id, i) => { files.current.set(id, decoded[i].file); startUpload(id, decoded[i].file); });
  }, [startUpload]);

  const onDragEnter = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current += 1;
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);
  const onDragOver = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);
  const onDrop = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const el = e.currentTarget instanceof Element ? e.currentTarget : null;
    const r = el?.getBoundingClientRect();
    const world = screenToWorld(ref.current.camera, { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
    void addFiles(Array.from(e.dataTransfer?.files ?? []), { kind: 'point', world });
  }, [addFiles]);

  const onPaste = useCallback((e: PasteLike) => {
    if (isEditable(e.target) || isEditable(document.activeElement)) return;
    const pasted = Array.from(e.clipboardData?.files ?? [])
      .filter((f) => (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(f.type) || f.type.startsWith('image/'));
    if (pasted.length === 0) return;
    e.preventDefault();
    void addFiles(pasted, { kind: 'centre' });
  }, [addFiles]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => onPaste(e);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [onPaste]);

  const openPicker = useCallback(() => {
    if (!isOnline(ref.current.connection)) { showToast(REJECTION_MESSAGES.offline); ref.current.onPickerDone?.(); return; }
    inputRef.current?.click();
  }, []);

  const onPickerChange = useCallback((list: readonly File[]) => {
    void addFiles(list, { kind: 'centre' }).finally(() => ref.current.onPickerDone?.());
  }, [addFiles]);

  const retry = useCallback((id: string) => {
    const file = files.current.get(id);
    if (!file || !isOnline(ref.current.connection)) return false;
    if (!markImageRetrying(ref.current.doc, id, Date.now())) return false;
    startUpload(id, file);
    return true;
  }, [startUpload]);
  const canRetry = useCallback((id: string) => files.current.has(id), []);

  return {
    onDragEnter, onDragLeave, onDragOver, onDrop, onPaste, openPicker, progress, retry, canRetry,
    dragActive, inputRef, onPickerChange,
  };
}
