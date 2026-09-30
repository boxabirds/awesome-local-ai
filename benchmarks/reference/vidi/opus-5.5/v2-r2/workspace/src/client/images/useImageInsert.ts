import { type DragEvent as ReactDragEvent, useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { objectsMap } from '../../shared/board-model';
import { IMAGE_ACCEPTED_TYPES, TOAST_DURATION_MS } from '../../shared/config';
import {
  createImagePlaceholders,
  getImageStatus,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
} from '../../shared/objects/image';
import type { UndoController } from '../board/undo';
import { isEditableTarget } from '../canvas/BoardViewport';
import { type Camera, type Point, type Size, screenToWorld } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage } from './uploadImage';
import { type FileRejection, REJECTION_MESSAGES, rejectionMessages, validateFiles } from './validateFiles';

type DragLike = DragEvent | ReactDragEvent<HTMLElement>;

/** Uploads may start only while the live connection is up (image.offline). */
export function isOnline(connection: ConnectionState): boolean {
  return connection === 'connected' || connection === 'confirmed';
}

function hasFiles(e: DragLike): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

/** Natural pixel size of an image file; rejects when the browser cannot decode it. */
async function measure(file: File): Promise<Size> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  if (!(size.width > 0 && size.height > 0)) throw new Error('empty image');
  return size;
}

type Placement = { kind: 'point'; world: Point } | { kind: 'centre' };

export interface ImageInsert {
  onDragEnter(e: DragLike): void;
  onDragOver(e: DragLike): void;
  onDragLeave(e: DragLike): void;
  onDrop(e: DragLike): void;
  onPaste(e: ClipboardEvent): void;
  /** Opens the system file picker (Image button, I key); offline → message instead. */
  openPicker(): void;
  /** Upload progress (0…1) of this tab's running uploads, by image id. */
  progress: ReadonlyMap<string, number>;
  /** Re-uploads a failed image whose file is still in memory; false otherwise. */
  retry(id: string): boolean;
  canRetry(id: string): boolean;
  /** Files are being dragged over the board (drop highlight). */
  dropActive: boolean;
  /** Current toast lines (cleared after TOAST_DURATION_MS). */
  messages: readonly string[];
}

/**
 * Adding images (image.insert): drop, paste and the Image tool's picker.
 * Files are validated (type, size, count), measured, placed as `uploading`
 * placeholders in one undo step, then uploaded in parallel; each result sets
 * the image ready or failed (untracked by undo). Files stay in memory for
 * Retry until the page is reloaded.
 */
export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** Visible board size (screen px): paste and picker centre images in it. */
  viewportSize?: Size;
  /** One undo step per add action. */
  undo?: UndoController;
  /** False while the board cannot be edited: nothing can be added. */
  canEdit?: boolean;
  /** True while text is being edited on the board: paste is left to the editor. */
  editing?: boolean;
}): ImageInsert {
  const latest = useRef(a);
  latest.current = a;
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);
  const files = useRef(new Map<string, File>());
  /** Uploads that finished after their placeholder was removed (e.g. undone): applied if it comes back (redo). */
  const finished = useRef(new Map<string, string>());
  const uploads = useRef(new Map<string, () => void>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposed = useRef(false);
  // Chosen files are only handled while mounted.
  const picker = useRef<HTMLInputElement | null>(null);

  const toast = useCallback((lines: readonly string[]) => {
    if (lines.length === 0) return;
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setMessages(lines);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setMessages([]);
    }, TOAST_DURATION_MS);
  }, []);

  const setFraction = useCallback((id: string, fraction: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (!file) return;
      const { doc, boardId } = latest.current;
      setFraction(id, 0);
      const upload = uploadImage(boardId, file, (f) => {
        if (!disposed.current) setFraction(id, f);
      });
      uploads.current.set(id, upload.abort);
      void upload.promise.then((result) => {
        uploads.current.delete(id);
        if (disposed.current) return;
        setFraction(id, null);
        if (result.kind === 'ok') {
          files.current.delete(id);
          if (!markImageReady(doc, id, result.assetKey)) finished.current.set(id, result.assetKey);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [setFraction],
  );

  const online = () => isOnline(latest.current.connection);

  const addFiles = useCallback(
    async (list: readonly File[], placement: Placement) => {
      if ((latest.current.canEdit ?? true) === false || list.length === 0) return;
      if (!isOnline(latest.current.connection)) {
        toast([REJECTION_MESSAGES.offline]);
        return;
      }
      const { accepted, rejections } = validateFiles(list);
      const measured: { file: File; size: Size }[] = [];
      const refused = new Set<FileRejection>(rejections);
      for (const file of accepted) {
        try {
          measured.push({ file, size: await measure(file) });
        } catch {
          // Not decodable as an image: refused like any unsupported file.
          refused.add('type');
        }
      }
      toast(rejectionMessages(refused));
      if (disposed.current || measured.length === 0) return;
      const { doc, camera, viewportSize, identityId, undo } = latest.current;
      if (!isOnline(latest.current.connection)) {
        toast([REJECTION_MESSAGES.offline]);
        return;
      }
      const sizes = measured.map((m) => placementSize(m.size.width, m.size.height));
      const rects =
        placement.kind === 'point'
          ? layoutRow(sizes, placement.world, 'top-left')
          : layoutRow(
              sizes,
              screenToWorld(camera, {
                x: (viewportSize?.width ?? window.innerWidth) / 2,
                y: (viewportSize?.height ?? window.innerHeight) / 2,
              }),
              'centre',
            );
      undo?.boundary();
      const ids = createImagePlaceholders(
        doc,
        measured.map((m, i) => ({
          rect: rects[i]!,
          naturalWidth: m.size.width,
          naturalHeight: m.size.height,
          contentType: m.file.type,
        })),
        identityId,
        Date.now(),
      );
      undo?.boundary();
      ids.forEach((id, i) => {
        files.current.set(id, measured[i]!.file);
        startUpload(id);
      });
    },
    [startUpload, toast],
  );

  const retry = useCallback(
    (id: string) => {
      if (!files.current.has(id) || uploads.current.has(id)) return false;
      if (!isOnline(latest.current.connection)) {
        toast([REJECTION_MESSAGES.offline]);
        return false;
      }
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id);
      return true;
    },
    [startUpload, toast],
  );

  const canRetry = useCallback((id: string) => files.current.has(id) && !uploads.current.has(id), []);

  const onDragEnter = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDropActive(true);
  }, []);

  const onDragOver = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    // Allows the drop; the pointer shows a copy indicator.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }, []);

  const onDragLeave = useCallback((e: DragLike) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropActive(false);
  }, []);

  const onDrop = useCallback(
    (e: DragLike) => {
      dragDepth.current = 0;
      setDropActive(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      const list = [...(e.dataTransfer?.files ?? [])];
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const world = screenToWorld(latest.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      const usable = Number.isFinite(world.x) && Number.isFinite(world.y);
      void addFiles(list, usable ? { kind: 'point', world } : { kind: 'centre' });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // A note, text, label or any field being edited keeps its own paste.
      if (latest.current.editing || isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const list = [...(e.clipboardData?.files ?? [])];
      if (list.length === 0) return;
      e.preventDefault();
      void addFiles(list, { kind: 'centre' });
    },
    [addFiles],
  );

  const openPicker = useCallback(() => {
    if ((latest.current.canEdit ?? true) === false) return;
    if (!online()) {
      toast([REJECTION_MESSAGES.offline]);
      return;
    }
    picker.current?.click();
  }, [toast]);

  // The hidden file input behind the Image tool (filtered to the accepted types).
  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.hidden = true;
    input.setAttribute('data-testid', 'image-file-input');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    const onChange = () => {
      const chosen = [...(input.files ?? [])];
      input.value = '';
      void addFiles(chosen, { kind: 'centre' });
    };
    input.addEventListener('change', onChange);
    document.body.appendChild(input);
    picker.current = input;
    return () => {
      input.removeEventListener('change', onChange);
      input.remove();
      picker.current = null;
    };
  }, [addFiles]);

  // Paste anywhere on the page (the page is the board).
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  // Files dropped outside the board (e.g. on a toolbar) are never opened by the browser.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const end = () => {
      dragDepth.current = 0;
      setDropActive(false);
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, []);

  // An upload that completed while its placeholder was undone is applied when redo brings it back.
  useEffect(() => {
    const map = objectsMap(a.doc);
    const onChange = (event: Y.YMapEvent<Y.Map<unknown>>) => {
      if (finished.current.size === 0) return;
      for (const key of event.keysChanged) {
        const assetKey = finished.current.get(key);
        if (assetKey === undefined || getImageStatus(a.doc, key) !== 'uploading') continue;
        finished.current.delete(key);
        // After the redo transaction, as its own untracked change.
        queueMicrotask(() => markImageReady(a.doc, key, assetKey));
      }
    };
    map.observe(onChange);
    return () => map.unobserve(onChange);
  }, [a.doc]);

  useEffect(() => {
    disposed.current = false;
    const running = uploads.current;
    return () => {
      disposed.current = true;
      for (const abort of running.values()) abort();
      running.clear();
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  return { onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, progress, retry, canRetry, dropActive, messages };
}
