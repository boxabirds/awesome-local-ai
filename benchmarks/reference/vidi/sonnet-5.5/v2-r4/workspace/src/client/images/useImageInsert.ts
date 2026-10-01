import { useCallback, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { createImagePlaceholders, layoutRow, markImageFailed, markImageReady, markImageRetrying, placementSize } from '../../shared/objects/image';
import type { UndoController } from '../board/undo';
import { screenToWorld, type Camera } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { showToast } from '../ui/Toast';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles, type FileRejection } from './validateFiles';

/** The parts of drag and clipboard events used here (native and React events both fit). */
interface DragLike {
  clientX: number;
  clientY: number;
  dataTransfer: DataTransfer | null;
  preventDefault(): void;
}
interface PasteLike {
  clipboardData: DataTransfer | null;
  target: EventTarget | null;
  preventDefault(): void;
}

export interface ImageInsert {
  onDragEnter(e: Pick<DragLike, 'dataTransfer'>): void;
  onDragOver(e: DragLike): void;
  onDragLeave(e: Pick<DragLike, 'dataTransfer'>): void;
  onDrop(e: DragLike): void;
  onPaste(e: PasteLike): void;
  openPicker(): void;
  /** True while files are dragged over the board. */
  dragActive: boolean;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

const isOnline = (c: ConnectionState) => c === 'connected' || c === 'confirmed';
const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes('Files');

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

const ORDER: FileRejection[] = ['type', 'size', 'count'];

/** Drop, paste and picker flows: validate, measure, place placeholders (one undo step), upload with progress. */
export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  undo?: UndoController;
}): ImageInsert {
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const files = useRef(new Map<string, File>());
  const latest = useRef(a);
  latest.current = a;

  const setProgressFor = useCallback((id: string, value: number | null) => {
    setProgress((prev) => {
      const next = new Map(prev);
      if (value === null) next.delete(id);
      else next.set(id, value);
      return next;
    });
  }, []);

  const startUpload = useCallback(
    (id: string, file: File) => {
      files.current.set(id, file);
      setProgressFor(id, 0);
      const { promise } = uploadImage(latest.current.boardId, file, (f) => setProgressFor(id, f));
      void promise.then((r) => {
        setProgressFor(id, null);
        if (r.kind === 'ok') {
          files.current.delete(id);
          markImageReady(latest.current.doc, id, r.assetKey);
        } else markImageFailed(latest.current.doc, id);
      });
    },
    [setProgressFor],
  );

  const add = useCallback(
    async (input: readonly File[], where: { kind: 'point'; world: { x: number; y: number } } | { kind: 'centre' }) => {
      const { doc, camera, connection, identityId, undo } = latest.current;
      if (!isOnline(connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(input);
      const measured: { file: File; w: number; h: number }[] = [];
      for (const file of accepted) {
        try {
          const bmp = await createImageBitmap(file);
          const w = bmp.width;
          const h = bmp.height;
          bmp.close?.();
          if (w > 0 && h > 0) measured.push({ file, w, h });
          else rejections.add('type');
        } catch {
          rejections.add('type');
        }
      }
      for (const r of ORDER) if (rejections.has(r)) showToast(REJECTION_MESSAGES[r]);
      if (measured.length === 0) return;
      // The connection may have dropped while decoding.
      if (!isOnline(latest.current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return;
      }
      const sizes = measured.map((m) => placementSize(m.w, m.h));
      const start =
        where.kind === 'point'
          ? where.world
          : screenToWorld(camera, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const rects = layoutRow(sizes, start, where.kind === 'point' ? 'top-left' : 'centre');
      undo?.boundary();
      const ids = createImagePlaceholders(
        doc,
        measured.map((m, i) => ({ rect: rects[i], naturalWidth: m.w, naturalHeight: m.h, contentType: m.file.type })),
        identityId,
        Date.now(),
      );
      undo?.boundary();
      // Items with unusable sizes are skipped by the model, so ids can be shorter than `measured`.
      let k = 0;
      measured.forEach((m, i) => {
        const r = rects[i];
        if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return;
        const id = ids[k++];
        if (id) startUpload(id, m.file);
      });
    },
    [startUpload],
  );

  const onDragEnter = useCallback((e: Pick<DragLike, 'dataTransfer'>) => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current += 1;
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: Pick<DragLike, 'dataTransfer'>) => {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);
  const onDragOver = useCallback((e: DragLike) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onDrop = useCallback(
    (e: DragLike) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const list = Array.from(e.dataTransfer?.files ?? []);
      if (list.length === 0) return;
      const world = screenToWorld(latest.current.camera, { x: e.clientX, y: e.clientY });
      void add(list, { kind: 'point', world });
    },
    [add],
  );

  const onPaste = useCallback(
    (e: PasteLike) => {
      if (isTextTarget(e.target) || isTextTarget(document.activeElement)) return;
      const cd = e.clipboardData;
      if (!cd) return;
      let list = Array.from(cd.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (list.length === 0) {
        list = Array.from(cd.items ?? [])
          .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
          .map((i) => i.getAsFile())
          .filter((f): f is File => f !== null);
      }
      if (list.length === 0) return;
      e.preventDefault();
      void add(list, { kind: 'centre' });
    },
    [add],
  );

  const openPicker = useCallback(() => {
    if (!isOnline(latest.current.connection)) {
      showToast(REJECTION_MESSAGES.offline);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('data-testid', 'image-picker');
    input.onchange = () => {
      const list = Array.from(input.files ?? []);
      input.remove();
      if (list.length > 0) void add(list, { kind: 'centre' });
    };
    input.oncancel = () => input.remove();
    document.body.appendChild(input);
    input.click();
  }, [add]);

  const retry = useCallback(
    (id: string) => {
      const file = files.current.get(id);
      if (!file) return false;
      if (!isOnline(latest.current.connection)) {
        showToast(REJECTION_MESSAGES.offline);
        return false;
      }
      if (!markImageRetrying(latest.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );
  const canRetry = useCallback((id: string) => files.current.has(id), []);

  return { onDragEnter, onDragOver, onDragLeave, onDrop, onPaste, openPicker, dragActive, progress, retry, canRetry };
}
