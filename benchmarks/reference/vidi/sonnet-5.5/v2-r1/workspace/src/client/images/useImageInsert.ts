import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type * as Y from 'yjs';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import { createImagePlaceholders, layoutRow, markImageFailed, markImageReady, markImageRetrying, placementSize } from '../../shared/objects/image';
import type { UndoController } from '../board/undo';
import { screenToWorld } from '../canvas/camera';
import type { Camera, Point } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';
import { uploadImage } from './uploadImage';
import { REJECTION_MESSAGES, validateFiles } from './validateFiles';
import type { FileRejection } from './validateFiles';

const HALF = 2;
const ACCEPT = IMAGE_ACCEPTED_TYPES.join(',');
const ROW_ORDER: (FileRejection | 'offline')[] = ['type', 'size', 'count'];

export interface ImageInsert {
  dragActive: boolean;
  toast: string | null;
  dismissToast(): void;
  onDragEnter(e: ReactDragEvent): void;
  onDragLeave(e: ReactDragEvent): void;
  onDragOver(e: ReactDragEvent): void;
  onDrop(e: ReactDragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  progress: ReadonlyMap<string, number>;
  retry(id: string): boolean;
  canRetry(id: string): boolean;
}

export const isOnline = (c: ConnectionState): boolean => c === 'connected' || c === 'confirmed';

function hasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

function isEditingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function useImageInsert(a: {
  doc: Y.Doc;
  boardId: string;
  camera: Camera;
  connection: ConnectionState;
  identityId: string;
  /** World point at the centre of the visible area (defaults to the camera and window size). */
  viewCentre?: () => Point;
  undo?: UndoController;
  /** Called when files were chosen or the picker was cancelled. */
  onPickerClosed?: () => void;
}): ImageInsert {
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const files = useRef(new Map<string, File>());
  const live = useRef(a);
  live.current = a;
  const dragDepth = useRef(0);

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
      setProgressFor(id, 0);
      const { promise } = uploadImage(live.current.boardId, file, (f) => setProgressFor(id, f));
      void promise.then((result) => {
        setProgressFor(id, null);
        if (result.kind === 'ok') {
          files.current.delete(id);
          markImageReady(live.current.doc, id, result.assetKey);
        } else markImageFailed(live.current.doc, id);
      });
    },
    [setProgressFor],
  );

  const addFiles = useCallback(
    async (list: readonly File[], at: { kind: 'drop'; point: Point } | { kind: 'centre' }) => {
      const cur = live.current;
      if (list.length === 0) return;
      if (!isOnline(cur.connection)) {
        setToast(REJECTION_MESSAGES.offline);
        return;
      }
      const { accepted, rejections } = validateFiles(list);
      const decoded: { file: File; naturalWidth: number; naturalHeight: number }[] = [];
      for (const file of accepted) {
        try {
          const bitmap = await createImageBitmap(file);
          decoded.push({ file, naturalWidth: bitmap.width, naturalHeight: bitmap.height });
          bitmap.close?.();
        } catch {
          rejections.add('type');
        }
      }
      if (rejections.size > 0) setToast(ROW_ORDER.filter((r) => rejections.has(r as FileRejection)).map((r) => REJECTION_MESSAGES[r]).join(' '));
      if (decoded.length === 0) return;
      // Connection may have dropped while decoding.
      if (!isOnline(live.current.connection)) {
        setToast(REJECTION_MESSAGES.offline);
        return;
      }
      const sizes = decoded.map((d) => placementSize(d.naturalWidth, d.naturalHeight));
      const start =
        at.kind === 'drop'
          ? at.point
          : (live.current.viewCentre?.() ??
            screenToWorld(live.current.camera, { x: window.innerWidth / HALF, y: window.innerHeight / HALF }));
      const rects = layoutRow(sizes, start, at.kind === 'drop' ? 'top-left' : 'centre');
      live.current.undo?.boundary();
      const ids = createImagePlaceholders(
        live.current.doc,
        decoded.map((d, i) => ({
          rect: rects[i],
          naturalWidth: d.naturalWidth,
          naturalHeight: d.naturalHeight,
          contentType: d.file.type,
        })),
        live.current.identityId,
        Date.now(),
      );
      live.current.undo?.boundary();
      ids.forEach((id, i) => {
        files.current.set(id, decoded[i].file);
        startUpload(id, decoded[i].file);
      });
    },
    [startUpload],
  );

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current++;
    setDragActive(true);
  }, []);
  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }, []);
  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const point = screenToWorld(live.current.camera, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      void addFiles(Array.from(e.dataTransfer?.files ?? []), { kind: 'drop', point });
    },
    [addFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      if (isEditingTarget(e.target as Element | null) || isEditingTarget(document.activeElement)) return;
      const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      e.preventDefault();
      void addFiles(images, { kind: 'centre' });
    },
    [addFiles],
  );

  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  const openPicker = useCallback(() => {
    if (!isOnline(live.current.connection)) {
      setToast(REJECTION_MESSAGES.offline);
      live.current.onPickerClosed?.();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.multiple = true;
    input.hidden = true;
    input.setAttribute('aria-label', 'Choose images');
    input.dataset.testid = 'image-picker';
    const done = () => {
      input.remove();
      live.current.onPickerClosed?.();
    };
    input.addEventListener('change', () => {
      const chosen = Array.from(input.files ?? []);
      done();
      void addFiles(chosen, { kind: 'centre' });
    });
    input.addEventListener('cancel', done);
    document.body.appendChild(input);
    input.click();
  }, [addFiles]);

  const retry = useCallback(
    (id: string): boolean => {
      const file = files.current.get(id);
      if (!file) return false;
      if (!isOnline(live.current.connection)) {
        setToast(REJECTION_MESSAGES.offline);
        return false;
      }
      if (!markImageRetrying(live.current.doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );
  const canRetry = useCallback((id: string) => files.current.has(id), []);

  return {
    dragActive,
    toast,
    dismissToast: useCallback(() => setToast(null), []),
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    onPaste,
    openPicker,
    progress,
    retry,
    canRetry,
  };
}
