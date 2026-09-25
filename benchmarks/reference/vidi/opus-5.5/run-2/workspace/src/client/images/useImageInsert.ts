/**
 * Adding images by drop, paste and the Image tool's file picker (anchor: image.insert).
 *
 * Every entry point runs the same flow:
 *  1. Offline gate: unless the board is `connected`/`confirmed`, show the offline message and
 *     add nothing (image.offline). A board that failed to load (story 4) adds nothing.
 *  2. `validateFiles` (type, size, count), then `createImageBitmap` per accepted file for its
 *     natural size; a file the browser cannot decode gets the type message (image.types).
 *  3. `placementSize` + `layoutRow` (top-left at the drop point, or centred in view for paste
 *     and picker), and one `createImagePlaceholders` call = one undo step (story 8).
 *  4. Parallel XHR uploads feeding `progress`; ok → `markImageReady`, rate_limited →
 *     `markImageFailed` + rate message, failed → `markImageFailed` (image.upload_failure).
 * Files are kept in memory by placeholder id so `retry(id)` can upload the same file again
 * (lost on reload by design: then only Remove is offered).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';
import { uploadImage } from './uploadImage';

const HALF = 2;
const REJECTION_ORDER: readonly FileRejection[] = ['type', 'size', 'count'];

type AnyDragEvent = DragEvent | ReactDragEvent;

export interface ImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Size of the board area, for "centred in the visible area". Default: the window. */
  viewport?: Size;
  /** Shows status messages (the bottom toast). */
  notify?(messages: readonly string[]): void;
  /** Story 8: closes the undo step around the placeholders. */
  history?: { boundary(): void };
}

export interface ImageInsertApi {
  onDragEnter(e: AnyDragEvent): void;
  onDragOver(e: AnyDragEvent): void;
  onDragLeave(e: AnyDragEvent): void;
  onDrop(e: AnyDragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** True while files are being dragged over the board (drop highlight). */
  dragging: boolean;
  /** Upload progress (0..1) of this tab's uploads, by image id. */
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

/** True when the drag carries files (not text or an element from the page). */
function hasFiles(e: AnyDragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types !== undefined && Array.from(types).includes('Files');
}

/** True when focus is somewhere that consumes pasted text. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

function isOnline(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

/** Natural pixel size of an image file, or null when the browser cannot decode it. */
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

export function useImageInsert(a: ImageInsertOptions): ImageInsertApi {
  const latest = useRef(a);
  latest.current = a;
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const files = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, () => void>());
  /** Bumped whenever `files` changes, so `canRetry` changes identity and consumers re-render. */
  const [filesVersion, setFilesVersion] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  const notify = (messages: readonly string[]) => latest.current.notify?.(messages);

  const setOne = (id: string, value: number | null) =>
    setProgress((prev) => {
      if (value === null ? !prev.has(id) : prev.get(id) === value) return prev;
      const next = new Map(prev);
      if (value === null) next.delete(id);
      else next.set(id, value);
      return next;
    });

  const startUpload = useCallback((id: string, file: File) => {
    const { boardId } = latest.current;
    setOne(id, 0);
    const job = uploadImage(boardId, file, (fraction) => setOne(id, fraction));
    uploads.current.set(id, job.abort);
    void job.promise.then((result) => {
      if (uploads.current.get(id) !== job.abort) return; // superseded or unmounted
      uploads.current.delete(id);
      setOne(id, null);
      const { doc } = latest.current;
      if (result.kind === 'ok') {
        markImageReady(doc, id, result.assetKey);
        files.current.delete(id);
        setFilesVersion((v) => v + 1);
        return;
      }
      markImageFailed(doc, id);
      if (result.kind === 'rate_limited') notify([REJECTION_MESSAGES.rate]);
    });
  }, []);

  /** Gate: false (with the offline message) unless images can be added now. */
  const canAdd = (): boolean => {
    const { connection } = latest.current;
    if (connection === 'load_failed') return false;
    if (!isOnline(connection)) {
      notify([REJECTION_MESSAGES.offline]);
      return false;
    }
    return true;
  };

  const addFiles = useCallback(
    async (list: readonly File[], at: Point, anchor: 'top-left' | 'centre') => {
      if (list.length === 0 || !canAdd()) return;
      const { accepted, rejections } = validateFiles(list);
      const measured = await Promise.all(accepted.map(async (file) => ({ file, size: await naturalSize(file) })));
      const decodable = measured.filter((m): m is { file: File; size: Size } => m.size !== null);
      if (decodable.length < measured.length) rejections.add('type');
      const messages = REJECTION_ORDER.filter((r) => rejections.has(r)).map((r) => REJECTION_MESSAGES[r]);
      if (decodable.length > 0) {
        const { doc, identityId, history } = latest.current;
        const rects = layoutRow(
          decodable.map((m) => placementSize(m.size.width, m.size.height)),
          at,
          anchor,
        );
        history?.boundary();
        const ids = createImagePlaceholders(
          doc,
          decodable.map((m, i) => ({
            rect: rects[i]!,
            naturalWidth: m.size.width,
            naturalHeight: m.size.height,
            contentType: m.file.type,
          })),
          identityId,
          Date.now(),
        );
        history?.boundary();
        ids.forEach((id, i) => {
          if (id === '') return;
          files.current.set(id, decodable[i]!.file);
          startUpload(id, decodable[i]!.file);
        });
        setFilesVersion((v) => v + 1);
      }
      if (messages.length > 0) notify(messages);
    },
    // canAdd and notify read `latest`, so the flow never goes stale.
    [startUpload],
  );

  const viewCentre = (): Point => {
    const { camera, viewport } = latest.current;
    const size = viewport ?? { width: window.innerWidth, height: window.innerHeight };
    return screenToWorld(camera, { x: size.width / HALF, y: size.height / HALF });
  };

  // The picker: a hidden file input, filtered to the accepted types.
  useEffect(() => {
    const el = document.createElement('input');
    el.type = 'file';
    el.multiple = true;
    el.accept = IMAGE_ACCEPTED_TYPES.join(',');
    el.hidden = true;
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.dataset.testid = 'image-picker';
    const onChange = () => {
      const chosen = Array.from(el.files ?? []);
      el.value = '';
      void addFiles(chosen, viewCentre(), 'centre');
    };
    el.addEventListener('change', onChange);
    document.body.appendChild(el);
    input.current = el;
    return () => {
      el.removeEventListener('change', onChange);
      el.remove();
      input.current = null;
    };
  }, [addFiles]);

  // Leaving the board abandons uploads still running (their placeholders become unfinished).
  useEffect(
    () => () => {
      const running = [...uploads.current.values()];
      uploads.current.clear();
      running.forEach((abort) => abort());
    },
    [],
  );

  const onDragEnter = useCallback((e: AnyDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }, []);
  const onDragOver = useCallback((e: AnyDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // allows the drop
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }, []);
  const onDragLeave = useCallback((e: AnyDragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);
  const onDrop = useCallback(
    (e: AnyDragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      e.preventDefault(); // never let the browser open the file
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      const target = e.currentTarget instanceof Element ? e.currentTarget : null;
      const box = target?.getBoundingClientRect();
      const local = { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
        void addFiles(dropped, viewCentre(), 'centre'); // no usable drop point
        return;
      }
      void addFiles(dropped, screenToWorld(latest.current.camera, local), 'top-left');
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Pasting into a note, text, label or field stays a text paste (image.paste).
      if (isTextTarget(e.target) || isTextTarget(document.activeElement)) return;
      const pasted = Array.from(e.clipboardData?.files ?? []);
      const images = pasted.filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return; // no image on the clipboard: nothing to do
      e.preventDefault();
      void addFiles(images, viewCentre(), 'centre');
    },
    [addFiles],
  );

  const openPicker = useCallback(() => {
    if (!canAdd()) return;
    input.current?.click();
  }, []);

  const canRetry = useCallback((id: string) => files.current.has(id), [filesVersion]);
  const retry = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (file === undefined || !canAdd()) return false;
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  return useMemo(
    () => ({ onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, dragging, progress, retry, canRetry }),
    [onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, dragging, progress, retry, canRetry],
  );
}
