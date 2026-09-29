// Image insertion orchestration (see spec: image.insert).
//
// One hook drives all four entry points: drop (top-left at the drop point),
// paste and picker (centred in view). Sequence per action (design):
//   1. offline gate (image.offline) — not connected → offline toast, stop;
//   2. validateFiles (count, type, size) — toasts for every rejection kind;
//   3. measure natural dimensions (decode failure → type toast, no object);
//   4. createImagePlaceholders — ONE LOCAL_ORIGIN transaction (one undo
//      step for the whole action);
//   5. upload each file in parallel with XHR progress feeding `progress`;
//      ok → markImageReady, rate_limited → failed + rate toast,
//      failed → markImageFailed (image.upload_failure).
//
// Retry keeps the File in memory (id → File map, lost on reload by design)
// and re-uploads after markImageRetrying.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { Point } from '../../shared/geometry';
import type { Camera, Size } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { IMAGE_ACCEPTED_TYPES } from '../../shared/config';
import type { ConnectionState } from '../sync/connectBoard';
import {
  createImagePlaceholders,
  layoutRow,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  placementSize,
  type ImagePlaceholderItem,
} from '../../shared/objects/image';
import { measureImage } from './measureImage';
import {
  REJECTION_MESSAGES,
  validateFiles,
} from './validateFiles';
import { uploadImage } from './uploadImage';

/** The hook's drop/paste entry points (design contract) plus drag state. */
export interface ImageInsertApi {
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
  onPaste(e: ClipboardEvent): void;
  openPicker(): void;
  /** Upload progress per image id (uploader's view, 0..1). */
  progress: ReadonlyMap<string, number>;
  /** Re-upload a failed image whose File is still in memory. */
  retry(id: string): boolean;
  /** True while an image File is kept in memory (Retry is offered). */
  canRetry(id: string): boolean;
  /** True while files are being dragged over the board (drop highlight). */
  dragActive: boolean;
}

export interface ImageInsertOptions {
  doc: Y.Doc;
  boardId: string;
  /** Live camera; the hook reads it from a ref so drops use the latest. */
  camera: Camera;
  connection: ConnectionState;
  /** This client's identity (doc.clientID wrapper) — the uploaderId. */
  identityId: string;
  /** Toast sink (design side channel; exact PRD messages). */
  onToast?: (message: string) => void;
  /** The board surface element (drop point + view centre, CSS px). */
  viewportEl?: HTMLElement | null;
  /** Viewport size in CSS px (centre placement); defaults to viewportEl. */
  viewportSize?: Size;
}

type Placement = { kind: 'point'; point: Point } | { kind: 'centre' };

function inEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

export function useImageInsert(options: ImageInsertOptions): ImageInsertApi {
  const optsRef = useRef(options);
  optsRef.current = options;

  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const filesRef = useRef(new Map<string, File>());

  const setProgressFor = useCallback((id: string, fraction: number | null) => {
    setProgress((current) => {
      const next = new Map(current);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }, []);

  /** Upload one file for one placeholder; maps the result to doc state. */
  const startUpload = useCallback(
    (id: string, file: File) => {
      filesRef.current.set(id, file);
      const { boardId, doc, onToast } = optsRef.current;
      const handle = uploadImage(boardId, file, (fraction) => setProgressFor(id, fraction));
      void handle.promise.then((result) => {
        setProgressFor(id, null);
        if (result.kind === 'ok') {
          markImageReady(doc, id, result.assetKey);
        } else if (result.kind === 'rate_limited') {
          markImageFailed(doc, id);
          onToast?.(REJECTION_MESSAGES.rate);
        } else {
          markImageFailed(doc, id);
        }
      });
    },
    [setProgressFor],
  );

  const insertFiles = useCallback(
    (files: readonly File[], placement: Placement) => {
      const { doc, camera, connection, identityId, onToast, viewportEl, viewportSize } = optsRef.current;
      // 1. Offline gate (image.offline).
      if (connection !== 'connected' && connection !== 'confirmed') {
        onToast?.(REJECTION_MESSAGES.offline);
        return;
      }
      // 2. Validation (image.types / image.size_limit / image.count_limit).
      const { accepted, rejections } = validateFiles(files);
      for (const kind of ['count', 'type', 'size'] as const) {
        if (rejections.has(kind)) onToast?.(REJECTION_MESSAGES[kind]);
      }
      if (accepted.length === 0) return;
      // 3. Measure natural dimensions in parallel; a decode failure is a
      //    type rejection for that file (TC-29).
      void Promise.all(
        accepted.map(async (file) => {
          try {
            const natural = await measureImage(file);
            return { file, natural };
          } catch {
            onToast?.(REJECTION_MESSAGES.type);
            return null;
          }
        }),
      ).then((measured) => {
        const ok = measured.filter((m): m is NonNullable<typeof m> => m !== null);
        if (ok.length === 0) return;
        // Placement point: the drop point, or the visible-area centre.
        let anchor: Point;
        if (placement.kind === 'point') {
          anchor = placement.point;
        } else {
          const size =
            viewportSize ??
            (viewportEl !== null && viewportEl !== undefined
              ? { width: viewportEl.clientWidth, height: viewportEl.clientHeight }
              : { width: 0, height: 0 });
          anchor = screenToWorld(camera, { x: size.width / 2, y: size.height / 2 });
        }
        const items: ImagePlaceholderItem[] = ok.map(({ file, natural }) => {
          void file;
          const size = placementSize(natural.width, natural.height);
          return {
            rect: { x: 0, y: 0, ...size }, // x/y replaced by layoutRow
            naturalWidth: natural.width,
            naturalHeight: natural.height,
            contentType: natural.contentType,
          };
        });
        const sizes = items.map((it) => ({ width: it.rect.width, height: it.rect.height }));
        const rects = layoutRow(sizes, anchor, placement.kind === 'point' ? 'top-left' : 'centre');
        const finalItems = items.map((it, i) => ({ ...it, rect: rects[i]! }));
        // 4. One undo step for the whole action.
        const ids = createImagePlaceholders(doc, finalItems, identityId, Date.now());
        // 5. Upload in parallel.
        ids.forEach((id, i) => {
          const file = ok[i]!.file;
          startUpload(id, file);
        });
      });
    },
    [startUpload],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (types !== undefined && Array.from(types).includes('Files')) {
      e.preventDefault(); // allow the drop
      setDragActive(true);
    }
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    const el = optsRef.current.viewportEl;
    if (el === null || el === undefined) {
      setDragActive(false);
      return;
    }
    const related = e.relatedTarget;
    if (related === null || related === undefined || !(related instanceof Node) || !el.contains(related)) {
      setDragActive(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      const el = optsRef.current.viewportEl;
      const point =
        el !== null && el !== undefined
          ? screenToWorld(
              optsRef.current.camera,
              { x: e.clientX - el.getBoundingClientRect().left, y: e.clientY - el.getBoundingClientRect().top },
            )
          : { x: 0, y: 0 };
      insertFiles(files, { kind: 'point', point });
    },
    [insertFiles],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      // Paste while editing text goes to the editor (TC-18).
      if (inEditableTarget(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      insertFiles(files, { kind: 'centre' });
    },
    [insertFiles],
  );

  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPaste]);

  const openPicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = IMAGE_ACCEPTED_TYPES.join(',');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) insertFiles(files, { kind: 'centre' });
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }, [insertFiles]);

  const canRetry = useCallback((id: string) => filesRef.current.has(id), []);

  const retry = useCallback(
    (id: string) => {
      const file = filesRef.current.get(id);
      if (file === undefined) return false;
      const { doc } = optsRef.current;
      if (!markImageRetrying(doc, id, Date.now())) return false;
      startUpload(id, file);
      return true;
    },
    [startUpload],
  );

  return { onDragOver, onDragLeave, onDrop, onPaste, openPicker, progress, retry, canRetry, dragActive };
}
