// Adding images (story 12): drop, paste and the Image tool's file picker. Files are checked,
// measured, placed as placeholders in one undo step, then uploaded with progress; the upload's
// outcome is written with UPLOAD_ORIGIN (never an undo step of its own).
import { type DragEvent as ReactDragEvent, useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import {
  UPLOAD_ORIGIN,
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { type Camera, type Size, screenToWorld } from '../canvas/camera';
import { isEditableTarget } from '../canvas/isEditableTarget';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage } from './uploadImage';
import { type FileRejection, REJECTION_MESSAGES, validateFiles } from './validateFiles';

type Getter<T> = T | (() => T);
const read = <T,>(v: Getter<T>): T => (typeof v === 'function' ? (v as () => T)() : v);

/** Connection states in which uploads may start (story 3). */
export function isOnline(state: ConnectionState): boolean {
  return state === 'connected' || state === 'confirmed';
}

type AnyDragEvent = DragEvent | ReactDragEvent<HTMLElement>;

/** True when a drag carries files (not text or an element from the page). */
function isFileDrag(e: AnyDragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** Natural pixel size from decoding the file; null when it is not a decodable image. */
async function measure(file: File): Promise<Size | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

export interface ImageInsert {
  onDragEnter(e: AnyDragEvent): void;
  onDragOver(e: AnyDragEvent): void;
  onDragLeave(e: AnyDragEvent): void;
  onDrop(e: AnyDragEvent): void;
  onPaste(e: ClipboardEvent): void;
  /** Opens the file picker; false (offline toast, no picker) when images cannot be added now. */
  openPicker(): boolean;
  /** True while files are dragged over the board (drop highlight). */
  dragging: boolean;
  /** Upload progress (0..1) of this tab's uploads, by image id. */
  progress: ReadonlyMap<string, number>;
  /** Uploads the kept file of a failed image again. False when the file is gone or offline. */
  retry(id: string): boolean;
  /** Whether this tab still has the file of the image (lost on reload). */
  canRetry(id: string): boolean;
}

/**
 * Drop, paste and picker flows. `camera`/`viewport` may be getters (read when an add happens).
 * `notify` shows a message (toast); `boundary` closes the current undo step (story 8) so the
 * placeholders of one add form a step of their own; `onPickerClose` runs when the picker closes
 * (files chosen or cancelled); `canEdit` false (locked board) ignores every add.
 */
export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Getter<Camera>;
  viewport?: Getter<Size>;
  connection: ConnectionState;
  identityId: string;
  canEdit?: boolean;
  notify?(message: string): void;
  boundary?(): void;
  onPickerClose?(): void;
}): ImageInsert {
  const argsRef = useRef(a);
  argsRef.current = a;
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const files = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, { abort(): void }>());
  const [, setFilesVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const active = uploads.current;
    return () => {
      mounted.current = false;
      for (const u of active.values()) u.abort();
      active.clear();
    };
  }, []);

  const setProgressOf = useCallback((id: string, value: number | null) => {
    if (!mounted.current) return;
    setProgress((prev) => {
      if (value === null ? !prev.has(id) : prev.get(id) === value) return prev;
      const next = new Map(prev);
      if (value === null) next.delete(id);
      else next.set(id, value);
      return next;
    });
  }, []);

  const showRejections = useCallback((rejections: Iterable<FileRejection>) => {
    for (const r of rejections) argsRef.current.notify?.(REJECTION_MESSAGES[r]);
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      const { doc, boardId } = argsRef.current;
      setProgressOf(id, 0);
      const upload = uploadImage(boardId, file, (fraction) => setProgressOf(id, fraction));
      uploads.current.set(id, upload);
      void upload.promise.then((result) => {
        uploads.current.delete(id);
        setProgressOf(id, null);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
          files.current.delete(id);
          if (mounted.current) setFilesVersion((v) => v + 1);
          return;
        }
        // The service refused the file itself: explained like the same check in the browser,
        // and the placeholder goes (retrying would fail the same way).
        if (result.status === 413 || result.status === 415) {
          showRejections([result.status === 413 ? 'size' : 'type']);
          doc.transact(() => doc.getMap('objects').delete(id), UPLOAD_ORIGIN);
          files.current.delete(id);
          if (mounted.current) setFilesVersion((v) => v + 1);
          return;
        }
        markImageFailed(doc, id);
      });
    },
    [setProgressOf, showRejections],
  );

  /** Checks, measures and places `list`, then starts their uploads. */
  const addFiles = useCallback(
    async (list: readonly File[], at: { point: Point; anchor: 'top-left' | 'centre' } | null) => {
      const { accepted, rejections } = validateFiles(list);
      const measured = await Promise.all(accepted.map(measure));
      const ok: { file: File; size: Size }[] = [];
      measured.forEach((size, i) => {
        if (size) ok.push({ file: accepted[i], size });
        else rejections.add('type');
      });
      showRejections(rejections);
      if (ok.length === 0 || !mounted.current) return;
      const args = argsRef.current;
      const sizes = ok.map((o) => placementSize(o.size.width, o.size.height));
      let place = at;
      if (!place) {
        const viewport = args.viewport ? read(args.viewport) : { width: window.innerWidth, height: window.innerHeight };
        place = {
          point: screenToWorld(read(args.camera), { x: viewport.width / 2, y: viewport.height / 2 }),
          anchor: 'centre',
        };
      }
      const rects = layoutRow(sizes, place.point, place.anchor);
      args.boundary?.();
      const ids = createImagePlaceholders(
        args.doc,
        ok.map((o, i) => ({
          rect: rects[i],
          naturalWidth: o.size.width,
          naturalHeight: o.size.height,
          contentType: o.file.type,
        })),
        args.identityId,
        Date.now(),
      );
      args.boundary?.();
      ids.forEach((id, i) => files.current.set(id, ok[i].file));
      setFilesVersion((v) => v + 1);
      ids.forEach((id, i) => startUpload(id, ok[i].file));
    },
    [showRejections, startUpload],
  );

  /** False (with the offline toast) when adding is not possible now. */
  const ready = useCallback((): boolean => {
    const { connection, canEdit, notify } = argsRef.current;
    if (canEdit === false) return false;
    if (!isOnline(connection)) {
      notify?.(REJECTION_MESSAGES.offline);
      return false;
    }
    return true;
  }, []);

  const onDragEnter = useCallback((e: AnyDragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  }, []);
  const onDragOver = useCallback((e: AnyDragEvent) => {
    if (!isFileDrag(e)) return;
    // Allows the drop (otherwise the browser would open the file).
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = argsRef.current.canEdit === false ? 'none' : 'copy';
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: AnyDragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: AnyDragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const list = Array.from(e.dataTransfer?.files ?? []);
      if (list.length === 0 || !ready()) return;
      const target = e.currentTarget as HTMLElement | null;
      const rect = target?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const local = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      void addFiles(list, { point: screenToWorld(read(argsRef.current.camera), local), anchor: 'top-left' });
    },
    [addFiles, ready],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // A note, text, label or any field being edited keeps its own paste.
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const list = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) return;
      e.preventDefault();
      if (!ready()) return;
      void addFiles(list, null);
    },
    [addFiles, ready],
  );

  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(
    () => () => {
      inputRef.current?.remove();
      inputRef.current = null;
    },
    [],
  );
  const openPicker = useCallback((): boolean => {
    if (!ready()) return false;
    let input = inputRef.current;
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = IMAGE_ACCEPTED_TYPES.join(',');
      input.className = 'image-picker-input';
      input.setAttribute('aria-hidden', 'true');
      input.tabIndex = -1;
      input.hidden = true;
      input.dataset.testid = 'image-picker';
      document.body.appendChild(input);
      inputRef.current = input;
      input.addEventListener('change', () => {
        const chosen = Array.from(inputRef.current?.files ?? []);
        if (inputRef.current) inputRef.current.value = '';
        argsRef.current.onPickerClose?.();
        if (chosen.length > 0 && ready()) void addFiles(chosen, null);
      });
      input.addEventListener('cancel', () => argsRef.current.onPickerClose?.());
    }
    input.click();
    return true;
  }, [addFiles, ready]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (!file || !ready()) return false;
      if (!markImageRetrying(argsRef.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [ready, startUpload],
  );
  const canRetry = useCallback((id: string) => files.current.has(id), []);

  return { onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, dragging, progress, retry, canRetry };
}
